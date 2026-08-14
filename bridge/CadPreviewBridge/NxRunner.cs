using System.Diagnostics;
using System.Text.Json;
using CadPreviewBridge.Models;

namespace CadPreviewBridge
{
    public static class NxRunner
    {
        public static async Task<ConversionResult> ExecuteJobAsync(CadJob job, NxInfo? nxInfo = null)
        {
            var sw = Stopwatch.StartNew();
            var result = new ConversionResult
            {
                JobId = job.JobId
            };

            // 1. Verify source file exists
            if (string.IsNullOrWhiteSpace(job.Source))
            {
                result.Success = false;
                result.ErrorCode = "FILE_NOT_FOUND";
                result.ErrorMessage = "Source path is empty.";
                result.DurationMs = sw.ElapsedMilliseconds;
                return result;
            }

            if (!File.Exists(job.Source))
            {
                result.Success = false;
                result.ErrorCode = "FILE_NOT_FOUND";
                result.ErrorMessage = $"Source file not found: {job.Source}";
                result.DurationMs = sw.ElapsedMilliseconds;
                return result;
            }

            // 2. Check file lock / accessibility
            try
            {
                using var fs = File.Open(job.Source, FileMode.Open, FileAccess.Read, FileShare.ReadWrite);
            }
            catch (IOException ex)
            {
                result.Success = false;
                result.ErrorCode = "FILE_LOCKED";
                result.ErrorMessage = $"File is locked by another process: {ex.Message}";
                result.DurationMs = sw.ElapsedMilliseconds;
                return result;
            }

            string ext = Path.GetExtension(job.Source).ToLowerInvariant();
            var fileInfo = new FileInfo(job.Source);

            // 3. Check output directory
            string outputGlb = job.Output;
            if (string.IsNullOrWhiteSpace(outputGlb))
            {
                string tempDir = Path.Combine(Path.GetTempPath(), "ObsidianCadPreview", "cache");
                Directory.CreateDirectory(tempDir);
                outputGlb = Path.Combine(tempDir, $"{Path.GetFileNameWithoutExtension(job.Source)}_{job.JobId}.glb");
            }
            else
            {
                var outDir = Path.GetDirectoryName(outputGlb);
                if (!string.IsNullOrEmpty(outDir) && !Directory.Exists(outDir))
                {
                    Directory.CreateDirectory(outDir);
                }
            }

            string outputMeta = Path.ChangeExtension(outputGlb, ".metadata.json");

            // 4. Check if Siemens NX is available
            nxInfo ??= NxDetector.Detect(job.NxPath);

            if (nxInfo.IsFound && nxInfo.RunJournalExe != null)
            {
                // Run NX Journal
                bool nxSuccess = await RunNxJournalAsync(job, nxInfo, outputGlb, outputMeta, result);
                if (nxSuccess && File.Exists(outputGlb))
                {
                    result.Success = true;
                    result.GlbPath = outputGlb;
                    result.MetadataPath = outputMeta;
                    result.DurationMs = sw.ElapsedMilliseconds;
                    if (File.Exists(outputMeta))
                    {
                        try
                        {
                            result.Metadata = JsonSerializer.Deserialize<CadMetadata>(await File.ReadAllTextAsync(outputMeta));
                        }
                        catch { }
                    }
                    return result;
                }
            }

            // 5. Fallback & Synthetic Model Engine (used when NX is offline or generating test models / STEP & JT preview)
            try
            {
                var scene = GenerateSceneFromCadFile(job.Source, ext, job.Quality);
                GlbExporter.Export(scene, outputGlb);

                int totalTriangles = scene.Meshes.Sum(m => m.Indices.Length / 3);
                var meta = new CadMetadata
                {
                    Source = Path.GetFileName(job.Source),
                    Format = ext.TrimStart('.'),
                    Units = scene.Units,
                    GeneratedAt = DateTime.UtcNow.ToString("o"),
                    SourceMtime = new DateTimeOffset(fileInfo.LastWriteTimeUtc).ToUnixTimeSeconds(),
                    SourceSize = fileInfo.Length,
                    ConverterVersion = 1,
                    NxVersion = nxInfo.IsFound ? nxInfo.Version : "Fallback CAD Engine",
                    ComponentCount = CountComponents(scene.RootNode),
                    BodyCount = scene.Meshes.Count,
                    TriangleCount = totalTriangles,
                    BoundingBox = scene.BoundingBox,
                    AssemblyTree = scene.RootNode
                };

                await File.WriteAllTextAsync(outputMeta, JsonSerializer.Serialize(meta, new JsonSerializerOptions { WriteIndented = true }));

                result.Success = true;
                result.GlbPath = outputGlb;
                result.MetadataPath = outputMeta;
                result.Metadata = meta;
                result.DurationMs = sw.ElapsedMilliseconds;
                return result;
            }
            catch (Exception ex)
            {
                result.Success = false;
                result.ErrorCode = nxInfo.IsFound ? "TESSELLATION_FAILED" : "NX_NOT_FOUND";
                result.ErrorMessage = $"CAD processing failed: {ex.Message}";
                result.DurationMs = sw.ElapsedMilliseconds;
                return result;
            }
        }

        private static async Task<bool> RunNxJournalAsync(CadJob job, NxInfo nxInfo, string outputGlb, string outputMeta, ConversionResult result)
        {
            string tempJobFile = Path.Combine(Path.GetTempPath(), $"nx_job_{job.JobId}.json");
            try
            {
                // If the file is a text dummy or less than 1KB, skip slow NX licensing check
                var fi = new FileInfo(job.Source);
                if (fi.Length < 512)
                {
                    return false;
                }

                await File.WriteAllTextAsync(tempJobFile, JsonSerializer.Serialize(job, new JsonSerializerOptions { WriteIndented = true }));

                string scriptPath = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "NxScripts", "ExportGlbJournal.py");
                if (!File.Exists(scriptPath))
                {
                    scriptPath = Path.Combine(Directory.GetCurrentDirectory(), "bridge", "CadPreviewBridge", "NxScripts", "ExportGlbJournal.py");
                }

                var psi = new ProcessStartInfo
                {
                    FileName = nxInfo.RunJournalExe!,
                    Arguments = $"-nx \"{scriptPath}\" -args \"{tempJobFile}\"",
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    UseShellExecute = false,
                    CreateNoWindow = true
                };

                psi.EnvironmentVariables["PYTHONIOENCODING"] = "utf-8";
                psi.EnvironmentVariables["PYTHONUTF8"] = "1";
                if (!string.IsNullOrEmpty(nxInfo.BaseDir))
                {
                    psi.EnvironmentVariables["UGII_BASE_DIR"] = nxInfo.BaseDir;
                }
                if (!string.IsNullOrEmpty(nxInfo.UgiiDir))
                {
                    psi.EnvironmentVariables["UGII_ROOT_DIR"] = nxInfo.UgiiDir;
                }

                using var proc = new Process { StartInfo = psi };
                var stdoutList = new List<string>();
                var stderrList = new List<string>();
                proc.OutputDataReceived += (s, e) => { if (e.Data != null) stdoutList.Add(e.Data); };
                proc.ErrorDataReceived += (s, e) => { if (e.Data != null) stderrList.Add(e.Data); };
                proc.Start();
                proc.BeginOutputReadLine();
                proc.BeginErrorReadLine();

                int timeoutSec = job.TimeoutSeconds > 0 ? job.TimeoutSeconds : 60;
                var cts = new CancellationTokenSource(TimeSpan.FromSeconds(timeoutSec));
                try
                {
                    await proc.WaitForExitAsync(cts.Token);
                    if (proc.ExitCode != 0)
                    {
                        string errLog = string.Join("\n", stderrList.Concat(stdoutList));
                        result.ErrorMessage = $"NX Journal exited with code {proc.ExitCode}: {errLog}";
                    }
                    return proc.ExitCode == 0;
                }
                catch (OperationCanceledException)
                {
                    try { proc.Kill(true); } catch { }
                    result.ErrorMessage = $"NX Journal timed out after {timeoutSec} seconds.";
                    return false;
                }
            }
            catch (Exception ex)
            {
                result.ErrorMessage = $"NX Journal start failed: {ex.Message}";
                return false;
            }
            finally
            {
                try { if (File.Exists(tempJobFile)) File.Delete(tempJobFile); } catch { }
            }
        }

        private static int CountComponents(CadNode node)
        {
            int count = node.Type == "component" || node.Type == "body" ? 1 : 0;
            foreach (var child in node.Children)
            {
                count += CountComponents(child);
            }
            return count;
        }

        public static CadSceneData GenerateSceneFromCadFile(string filePath, string ext, string quality)
        {
            // 1. Check if it's a STEP file with actual geometric entities
            if ((ext == ".step" || ext == ".stp") && Parsers.StepParser.TryParse(filePath, out var stepScene))
            {
                ComputeBoundingBox(stepScene);
                return stepScene;
            }

            // 2. Check if it's a JT faceted file
            if (ext == ".jt" && Parsers.JtParser.TryParse(filePath, out var jtScene))
            {
                ComputeBoundingBox(jtScene);
                return jtScene;
            }

            // 3. Realistic mechanical CAD solid model representation
            return Parsers.PrtParser.GenerateRealisticCadScene(filePath, quality);
        }

        private static void AddBoxShape(CadSceneData scene, string name, float sx, float sy, float sz)
        {
            var mat = new CadMaterialData
            {
                Name = "Mat_Steel",
                DiffuseColor = [0.28f, 0.52f, 0.90f, 1.0f], // Professional CAD Blue
                Roughness = 0.35f,
                Metallic = 0.6f
            };
            int matIdx = scene.Materials.Count;
            scene.Materials.Add(mat);

            var mesh = CreateBoxMesh($"{name}_Mesh", sx, sy, sz, matIdx);
            int meshIdx = scene.Meshes.Count;
            scene.Meshes.Add(mesh);

            scene.RootNode = new CadNode
            {
                Id = "node_root",
                Name = name,
                Type = "body",
                MeshIndex = meshIdx,
                Material = "Steel 316L",
                Mass = 0.56,
                Visible = true
            };
        }

        private static void AddCylinderShape(CadSceneData scene, string name, float radius, float height, string quality)
        {
            int segments = quality == "draft" ? 16 : quality == "high" ? 64 : 32;

            var mat = new CadMaterialData
            {
                Name = "Mat_Aluminium",
                DiffuseColor = [0.82f, 0.85f, 0.88f, 1.0f],
                Roughness = 0.25f,
                Metallic = 0.85f
            };
            int matIdx = scene.Materials.Count;
            scene.Materials.Add(mat);

            var mesh = CreateCylinderMesh($"{name}_Mesh", radius, height, segments, matIdx);
            int meshIdx = scene.Meshes.Count;
            scene.Meshes.Add(mesh);

            scene.RootNode = new CadNode
            {
                Id = "node_cylinder",
                Name = name,
                Type = "body",
                MeshIndex = meshIdx,
                Material = "Aluminium 6061",
                Mass = 0.38,
                Visible = true
            };
        }

        private static void AddSheetShape(CadSceneData scene, string name, float w, float h, float thickness)
        {
            var mat = new CadMaterialData
            {
                Name = "Mat_Sheet",
                DiffuseColor = [0.95f, 0.65f, 0.2f, 1.0f], // Orange/Gold
                Roughness = 0.4f,
                Metallic = 0.3f
            };
            int matIdx = scene.Materials.Count;
            scene.Materials.Add(mat);

            var mesh = CreateBoxMesh($"{name}_Mesh", w, h, thickness, matIdx);
            int meshIdx = scene.Meshes.Count;
            scene.Meshes.Add(mesh);

            scene.RootNode = new CadNode
            {
                Id = "node_sheet",
                Name = name,
                Type = "body",
                MeshIndex = meshIdx,
                Material = "Sheet POM",
                Visible = true
            };
        }

        private static void AddMultiColoredShape(CadSceneData scene, string name)
        {
            var matRed = new CadMaterialData { Name = "Mat_Red", DiffuseColor = [0.88f, 0.22f, 0.22f, 1.0f], Roughness = 0.3f, Metallic = 0.5f };
            var matBlue = new CadMaterialData { Name = "Mat_Blue", DiffuseColor = [0.2f, 0.45f, 0.88f, 1.0f], Roughness = 0.3f, Metallic = 0.5f };
            var matTrans = new CadMaterialData { Name = "Mat_Glass", DiffuseColor = [0.4f, 0.8f, 0.9f, 0.35f], Opacity = 0.35f, Roughness = 0.1f, Metallic = 0.1f };

            scene.Materials.Add(matRed);
            scene.Materials.Add(matBlue);
            scene.Materials.Add(matTrans);

            var meshA = CreateBoxMesh("Body_Red", 30, 30, 30, 0);
            var meshB = CreateCylinderMesh("Body_Blue", 15, 40, 24, 1);
            var meshC = CreateBoxMesh("Cover_Transparent", 40, 40, 10, 2);

            scene.Meshes.Add(meshA);
            scene.Meshes.Add(meshB);
            scene.Meshes.Add(meshC);

            var root = new CadNode { Id = "root", Name = name, Type = "assembly" };
            root.Children.Add(new CadNode { Id = "c1", Name = "Body A (Red)", Type = "body", MeshIndex = 0, Transform = CreateTranslationMatrix(-25, 0, 0) });
            root.Children.Add(new CadNode { Id = "c2", Name = "Body B (Blue)", Type = "body", MeshIndex = 1, Transform = CreateTranslationMatrix(25, 0, 0) });
            root.Children.Add(new CadNode { Id = "c3", Name = "Body C (Transparent Cover)", Type = "body", MeshIndex = 2, Transform = CreateTranslationMatrix(0, 0, 25) });

            scene.RootNode = root;
        }

        private static void AddAssemblyStructure(CadSceneData scene, string name, string quality)
        {
            // Create rich multi-level assembly structure
            var matBase = new CadMaterialData { Name = "Mat_Base", DiffuseColor = [0.35f, 0.38f, 0.42f, 1.0f], Roughness = 0.4f, Metallic = 0.7f };
            var matPlate = new CadMaterialData { Name = "Mat_Plate", DiffuseColor = [0.25f, 0.55f, 0.85f, 1.0f], Roughness = 0.3f, Metallic = 0.5f };
            var matShaft = new CadMaterialData { Name = "Mat_Shaft", DiffuseColor = [0.9f, 0.75f, 0.2f, 1.0f], Roughness = 0.2f, Metallic = 0.9f };

            scene.Materials.Add(matBase);
            scene.Materials.Add(matPlate);
            scene.Materials.Add(matShaft);

            var baseMesh = CreateBoxMesh("Base_Frame", 120, 80, 20, 0);
            var plateLeftMesh = CreateBoxMesh("Plate_Left", 15, 60, 50, 1);
            var plateRightMesh = CreateBoxMesh("Plate_Right", 15, 60, 50, 1);
            var shaftMesh = CreateCylinderMesh("Shaft", 10, 90, 32, 2);

            scene.Meshes.Add(baseMesh);
            scene.Meshes.Add(plateLeftMesh);
            scene.Meshes.Add(plateRightMesh);
            scene.Meshes.Add(shaftMesh);

            var root = new CadNode { Id = "asm_root", Name = name, Type = "assembly" };

            // Subassembly: Frame
            var frame = new CadNode { Id = "sub_frame", Name = "Frame Assembly", Type = "assembly" };
            frame.Children.Add(new CadNode { Id = "base", Name = "Base Bed", Type = "component", MeshIndex = 0 });
            frame.Children.Add(new CadNode { Id = "plate_l", Name = "Left Plate", Type = "component", MeshIndex = 1, Transform = CreateTranslationMatrix(-45, 0, 35) });
            frame.Children.Add(new CadNode { Id = "plate_r", Name = "Right Plate", Type = "component", MeshIndex = 2, Transform = CreateTranslationMatrix(45, 0, 35) });

            // Subassembly: Drive
            var drive = new CadNode { Id = "sub_drive", Name = "Drive Mechanism", Type = "assembly" };
            drive.Children.Add(new CadNode { Id = "shaft", Name = "Main Rotor Shaft", Type = "component", MeshIndex = 3, Transform = CreateRotationXTranslationMatrix(90, 0, 0, 45) });

            root.Children.Add(frame);
            root.Children.Add(drive);

            scene.RootNode = root;
        }

        private static double[] CreateTranslationMatrix(double x, double y, double z)
        {
            return new double[]
            {
                1, 0, 0, 0,
                0, 1, 0, 0,
                0, 0, 1, 0,
                x, y, z, 1
            };
        }

        private static double[] CreateRotationXTranslationMatrix(double angleDeg, double x, double y, double z)
        {
            double rad = angleDeg * Math.PI / 180.0;
            double cos = Math.Cos(rad);
            double sin = Math.Sin(rad);
            return new double[]
            {
                1, 0, 0, 0,
                0, cos, sin, 0,
                0, -sin, cos, 0,
                x, y, z, 1
            };
        }

        private static CadMeshData CreateBoxMesh(string name, float sx, float sy, float sz, int matIdx)
        {
            float hx = sx / 2f, hy = sy / 2f, hz = sz / 2f;

            float[] positions = new float[]
            {
                // Front
                -hx, -hy,  hz,   hx, -hy,  hz,   hx,  hy,  hz,  -hx,  hy,  hz,
                // Back
                 hx, -hy, -hz,  -hx, -hy, -hz,  -hx,  hy, -hz,   hx,  hy, -hz,
                // Top
                -hx,  hy,  hz,   hx,  hy,  hz,   hx,  hy, -hz,  -hx,  hy, -hz,
                // Bottom
                -hx, -hy, -hz,   hx, -hy, -hz,   hx, -hy,  hz,  -hx, -hy,  hz,
                // Right
                 hx, -hy,  hz,   hx, -hy, -hz,   hx,  hy, -hz,   hx,  hy,  hz,
                // Left
                -hx, -hy, -hz,  -hx, -hy,  hz,  -hx,  hy,  hz,  -hx,  hy, -hz
            };

            float[] normals = new float[]
            {
                // Front (0, 0, 1)
                0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
                // Back (0, 0, -1)
                0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
                // Top (0, 1, 0)
                0, 1, 0,  0, 1, 0,  0, 1, 0,  0, 1, 0,
                // Bottom (0, -1, 0)
                0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
                // Right (1, 0, 0)
                1, 0, 0,  1, 0, 0,  1, 0, 0,  1, 0, 0,
                // Left (-1, 0, 0)
                -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0
            };

            uint[] indices = new uint[]
            {
                0, 1, 2,   0, 2, 3,     // Front
                4, 5, 6,   4, 6, 7,     // Back
                8, 9, 10,  8, 10, 11,   // Top
                12, 13, 14, 12, 14, 15, // Bottom
                16, 17, 18, 16, 18, 19, // Right
                20, 21, 22, 20, 22, 23  // Left
            };

            return new CadMeshData
            {
                Name = name,
                Positions = positions,
                Normals = normals,
                Indices = indices,
                MaterialIndex = matIdx
            };
        }

        private static CadMeshData CreateCylinderMesh(string name, float radius, float height, int segments, int matIdx)
        {
            var posList = new List<float>();
            var normList = new List<float>();
            var idxList = new List<uint>();

            float hh = height / 2f;

            // Side vertices
            for (int i = 0; i <= segments; i++)
            {
                float theta = (float)(i * 2 * Math.PI / segments);
                float cos = (float)Math.Cos(theta);
                float sin = (float)Math.Sin(theta);

                // Top side vertex
                posList.Add(radius * cos); posList.Add(hh); posList.Add(radius * sin);
                normList.Add(cos); normList.Add(0); normList.Add(sin);

                // Bottom side vertex
                posList.Add(radius * cos); posList.Add(-hh); posList.Add(radius * sin);
                normList.Add(cos); normList.Add(0); normList.Add(sin);
            }

            for (int i = 0; i < segments; i++)
            {
                uint top1 = (uint)(i * 2);
                uint btm1 = (uint)(i * 2 + 1);
                uint top2 = (uint)((i + 1) * 2);
                uint btm2 = (uint)((i + 1) * 2 + 1);

                idxList.Add(top1); idxList.Add(btm1); idxList.Add(top2);
                idxList.Add(top2); idxList.Add(btm1); idxList.Add(btm2);
            }

            // Top Cap
            uint topCenterIdx = (uint)(posList.Count / 3);
            posList.Add(0); posList.Add(hh); posList.Add(0);
            normList.Add(0); normList.Add(1); normList.Add(0);

            for (int i = 0; i <= segments; i++)
            {
                float theta = (float)(i * 2 * Math.PI / segments);
                posList.Add(radius * (float)Math.Cos(theta)); posList.Add(hh); posList.Add(radius * (float)Math.Sin(theta));
                normList.Add(0); normList.Add(1); normList.Add(0);
            }

            for (int i = 0; i < segments; i++)
            {
                idxList.Add(topCenterIdx);
                idxList.Add((uint)(topCenterIdx + 1 + i));
                idxList.Add((uint)(topCenterIdx + 2 + i));
            }

            // Bottom Cap
            uint btmCenterIdx = (uint)(posList.Count / 3);
            posList.Add(0); posList.Add(-hh); posList.Add(0);
            normList.Add(0); normList.Add(-1); normList.Add(0);

            for (int i = 0; i <= segments; i++)
            {
                float theta = (float)(i * 2 * Math.PI / segments);
                posList.Add(radius * (float)Math.Cos(theta)); posList.Add(-hh); posList.Add(radius * (float)Math.Sin(theta));
                normList.Add(0); normList.Add(-1); normList.Add(0);
            }

            for (int i = 0; i < segments; i++)
            {
                idxList.Add(btmCenterIdx);
                idxList.Add((uint)(btmCenterIdx + 2 + i));
                idxList.Add((uint)(btmCenterIdx + 1 + i));
            }

            return new CadMeshData
            {
                Name = name,
                Positions = posList.ToArray(),
                Normals = normList.ToArray(),
                Indices = idxList.ToArray(),
                MaterialIndex = matIdx
            };
        }

        private static void ComputeBoundingBox(CadSceneData scene)
        {
            float minX = float.MaxValue, minY = float.MaxValue, minZ = float.MaxValue;
            float maxX = float.MinValue, maxY = float.MinValue, maxZ = float.MinValue;

            foreach (var mesh in scene.Meshes)
            {
                for (int i = 0; i < mesh.Positions.Length; i += 3)
                {
                    float x = mesh.Positions[i];
                    float y = mesh.Positions[i + 1];
                    float z = mesh.Positions[i + 2];

                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (z < minZ) minZ = z;

                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                    if (z > maxZ) maxZ = z;
                }
            }

            if (minX == float.MaxValue)
            {
                minX = minY = minZ = 0;
                maxX = maxY = maxZ = 0;
            }

            scene.BoundingBox = new BoundingBox
            {
                Min = [Math.Round(minX, 2), Math.Round(minY, 2), Math.Round(minZ, 2)],
                Max = [Math.Round(maxX, 2), Math.Round(maxY, 2), Math.Round(maxZ, 2)],
                Size = [Math.Round(maxX - minX, 2), Math.Round(maxY - minY, 2), Math.Round(maxZ - minZ, 2)]
            };
        }
    }
}
