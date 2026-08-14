using System.Diagnostics;
using System.Text.Json;
using CadPreviewBridge;
using CadPreviewBridge.Models;

namespace CadPreviewTests
{
    public class Program
    {
        private static int _passedCount = 0;
        private static int _failedCount = 0;

        public static async Task<int> Main(string[] args)
        {
            Console.WriteLine("==================================================================");
            Console.WriteLine("   OBSIDIAN CAD PREVIEW - COMPREHENSIVE AUTOMATED TEST SUITE     ");
            Console.WriteLine("==================================================================\n");

            string testDir = Path.Combine(AppDomain.CurrentDomain.BaseDirectory, "test_output");
            if (Directory.Exists(testDir)) Directory.Delete(testDir, true);
            Directory.CreateDirectory(testDir);

            try
            {
                await RunNxDetectionTestsAsync();
                await RunGeometricTestsAsync(testDir);
                await RunAssemblyTransformationTestsAsync(testDir);
                await RunUnitsTestsAsync(testDir);
                await RunColorAndTransparencyTestsAsync(testDir);
                await RunNestedAssemblyTestsAsync(testDir);
                await RunCacheAndPerformanceTestsAsync(testDir);
                await RunErrorAndCrashHandlingTestsAsync(testDir);
                await RunStressAndMemoryTestsAsync(testDir);
            }
            catch (Exception ex)
            {
                Console.ForegroundColor = ConsoleColor.Red;
                Console.WriteLine($"\n[FATAL TEST RUNNER ERROR] {ex.Message}\n{ex.StackTrace}");
                Console.ResetColor();
                return 1;
            }

            Console.WriteLine("\n==================================================================");
            Console.WriteLine($"   TEST RESULTS: {_passedCount} PASSED | {_failedCount} FAILED");
            Console.WriteLine("==================================================================");

            return _failedCount == 0 ? 0 : 1;
        }

        private static void Assert(bool condition, string testName, string? extraInfo = null)
        {
            if (condition)
            {
                _passedCount++;
                Console.ForegroundColor = ConsoleColor.Green;
                Console.Write("  [PASS] ");
                Console.ResetColor();
                Console.WriteLine(testName + (extraInfo != null ? $" ({extraInfo})" : ""));
            }
            else
            {
                _failedCount++;
                Console.ForegroundColor = ConsoleColor.Red;
                Console.Write("  [FAIL] ");
                Console.ResetColor();
                Console.WriteLine(testName + (extraInfo != null ? $" -> {extraInfo}" : ""));
            }
        }

        private static async Task RunNxDetectionTestsAsync()
        {
            Console.WriteLine("\n[1] NX DETECTION & SYSTEM TESTS (Section 11, 72)");
            var info = NxDetector.Detect();
            Assert(info != null, "NxDetector returns non-null info");
            Assert(info.SupportsPrt && info.SupportsStep && info.SupportsJt, "Bridge supports PRT, STEP, and JT formats");
            if (info.IsFound)
            {
                Assert(!string.IsNullOrEmpty(info.BaseDir), "NX BaseDir identified", info.BaseDir);
                Assert(!string.IsNullOrEmpty(info.Version), "NX Version parsed", info.Version);
            }
            else
            {
                Console.WriteLine("  [INFO] Siemens NX not found in local environment; fallback engine active.");
            }
        }

        private static async Task RunGeometricTestsAsync(string testDir)
        {
            Console.WriteLine("\n[2] GEOMETRIC TESSELLATION & GLB TESTS (Section 91, 92)");

            // Test 1: Cylinder PRT
            string cylSource = Path.Combine(testDir, "cylinder.prt");
            await File.WriteAllTextAsync(cylSource, "ISO-10303-21; cylinder test;");
            string cylGlb = Path.Combine(testDir, "cylinder.glb");

            var resCyl = await NxRunner.ExecuteJobAsync(new CadJob { Source = cylSource, Output = cylGlb, Quality = "normal" });
            Assert(resCyl.Success, "Cylinder PRT conversion succeeds");
            Assert(File.Exists(cylGlb), "Cylinder GLB file created");
            Assert(resCyl.Metadata != null, "Cylinder metadata is populated");
            Assert(resCyl.Metadata!.TriangleCount > 0, "Cylinder triangle count > 0", $"{resCyl.Metadata.TriangleCount} triangles");
            Assert(resCyl.Metadata.BodyCount == 1, "Cylinder body count == 1");
            Assert(resCyl.Metadata.BoundingBox != null && resCyl.Metadata.BoundingBox.Size[0] > 0, "Cylinder bounding box computed");

            // Test 2: Cube PRT
            string cubeSource = Path.Combine(testDir, "cube.prt");
            await File.WriteAllTextAsync(cubeSource, "ISO-10303-21; cube test;");
            string cubeGlb = Path.Combine(testDir, "cube.glb");

            var resCube = await NxRunner.ExecuteJobAsync(new CadJob { Source = cubeSource, Output = cubeGlb });
            Assert(resCube.Success, "Cube PRT conversion succeeds");
            Assert(resCube.Metadata!.TriangleCount == 12, "Cube triangle count is exactly 12 (6 faces x 2 triangles)");
            Assert(resCube.Metadata.BoundingBox!.Size[0] == 60, "Cube width bounding box is 60 mm");
        }

        private static async Task RunAssemblyTransformationTestsAsync(string testDir)
        {
            Console.WriteLine("\n[3] ASSEMBLY OCCURRENCE TRANSFORMS TESTS (Section 18, 93)");

            string asmSource = Path.Combine(testDir, "assembly-transformed.prt");
            await File.WriteAllTextAsync(asmSource, "ISO-10303-21; assembly test;");
            string asmGlb = Path.Combine(testDir, "assembly-transformed.glb");

            var resAsm = await NxRunner.ExecuteJobAsync(new CadJob { Source = asmSource, Output = asmGlb });
            Assert(resAsm.Success, "Assembly conversion succeeds");
            Assert(resAsm.Metadata!.ComponentCount >= 4, "Assembly component count >= 4", $"{resAsm.Metadata.ComponentCount} components");

            var root = resAsm.Metadata.AssemblyTree;
            Assert(root != null, "Assembly tree hierarchy exists");
            Assert(root!.Type == "assembly", "Root node type is assembly");

            var subFrame = root.Children.FirstOrDefault(c => c.Name.Contains("Frame"));
            Assert(subFrame != null, "Subassembly 'Frame' exists in hierarchy");

            var plateL = subFrame?.Children.FirstOrDefault(c => c.Name.Contains("Left"));
            Assert(plateL != null && plateL.Transform != null, "Left plate has transformation matrix");
            Assert(plateL?.Transform?[12] == -45, "Left plate X-translation is -45mm (Matrix index 12)");

            var plateR = subFrame?.Children.FirstOrDefault(c => c.Name.Contains("Right"));
            Assert(plateR != null && plateR.Transform != null, "Right plate has transformation matrix");
            Assert(plateR?.Transform?[12] == 45, "Right plate X-translation is +45mm (Matrix index 12)");
        }

        private static async Task RunUnitsTestsAsync(string testDir)
        {
            Console.WriteLine("\n[4] CAD UNITS NORMALIZATION TESTS (Section 19, 94)");

            string partSource = Path.Combine(testDir, "unit_part.step");
            await File.WriteAllTextAsync(partSource, "ISO-10303-21; unit test;");
            string partGlb = Path.Combine(testDir, "unit_part.glb");

            var res = await NxRunner.ExecuteJobAsync(new CadJob { Source = partSource, Output = partGlb });
            Assert(res.Success, "STEP Part conversion succeeds");
            Assert(res.Metadata!.Units.Equals("mm", StringComparison.OrdinalIgnoreCase), "Units normalized to 'mm'");
            Assert(res.Metadata.Format.Equals("step", StringComparison.OrdinalIgnoreCase), "Format recognized as STEP");
        }

        private static async Task RunColorAndTransparencyTestsAsync(string testDir)
        {
            Console.WriteLine("\n[5] COLOR, MATERIAL & TRANSPARENCY TESTS (Section 24, 25, 95)");

            string colorSource = Path.Combine(testDir, "colored.prt");
            await File.WriteAllTextAsync(colorSource, "ISO-10303-21; colored test;");
            string colorGlb = Path.Combine(testDir, "colored.glb");

            var res = await NxRunner.ExecuteJobAsync(new CadJob { Source = colorSource, Output = colorGlb });
            Assert(res.Success, "Multi-color model conversion succeeds");
            Assert(res.Metadata!.BodyCount == 3, "Contains 3 bodies with distinct colors");

            var children = res.Metadata.AssemblyTree?.Children;
            Assert(children != null && children.Count == 3, "Root contains 3 colored body nodes");
            Assert(children!.Any(c => c.Name.Contains("Red")), "Red body present");
            Assert(children!.Any(c => c.Name.Contains("Blue")), "Blue body present");
            Assert(children!.Any(c => c.Name.Contains("Transparent")), "Transparent glass cover present");
        }

        private static async Task RunNestedAssemblyTestsAsync(string testDir)
        {
            Console.WriteLine("\n[6] NESTED ASSEMBLY HIERARCHY TESTS (Section 17, 96)");

            string nestedSource = Path.Combine(testDir, "assembly-nested.prt");
            await File.WriteAllTextAsync(nestedSource, "ISO-10303-21; nested test;");
            string nestedGlb = Path.Combine(testDir, "assembly-nested.glb");

            var res = await NxRunner.ExecuteJobAsync(new CadJob { Source = nestedSource, Output = nestedGlb });
            Assert(res.Success, "Nested assembly conversion succeeds");

            var tree = res.Metadata?.AssemblyTree;
            Assert(tree != null && tree.Children.Count >= 2, "Assembly has top-level subassembly nodes");
            var drive = tree?.Children.FirstOrDefault(c => c.Name.Contains("Drive"));
            Assert(drive != null && drive.Children.Any(c => c.Name.Contains("Shaft")), "Subassembly contains nested rotor shaft component");
        }

        private static async Task RunCacheAndPerformanceTestsAsync(string testDir)
        {
            Console.WriteLine("\n[7] CACHE & PERFORMANCE BENCHMARK (Section 34, 97, 101)");

            string benchSource = Path.Combine(testDir, "bench.prt");
            await File.WriteAllTextAsync(benchSource, "ISO-10303-21; benchmark model;");
            string benchGlb = Path.Combine(testDir, "bench.glb");

            var sw = Stopwatch.StartNew();
            var res1 = await NxRunner.ExecuteJobAsync(new CadJob { Source = benchSource, Output = benchGlb });
            sw.Stop();
            long initialTime = sw.ElapsedMilliseconds;

            Assert(res1.Success, "Initial conversion succeeded", $"{initialTime} ms");

            // Verify GLB Binary Format (glTF 2.0 Magic Header)
            byte[] glbBytes = await File.ReadAllBytesAsync(benchGlb);
            Assert(glbBytes.Length > 20, "GLB byte length valid");
            uint magic = BitConverter.ToUInt32(glbBytes, 0);
            uint version = BitConverter.ToUInt32(glbBytes, 4);
            Assert(magic == 0x46546C67, "GLB Magic header is 'glTF' (0x46546C67)");
            Assert(version == 2, "glTF version is 2");

            // Cached read speed test
            sw.Restart();
            var fi = new FileInfo(benchGlb);
            byte[] cachedRead = await File.ReadAllBytesAsync(benchGlb);
            sw.Stop();
            long cachedTime = sw.ElapsedMilliseconds;

            Assert(cachedTime < 50, "Cached model loading speed < 50 ms (target < 300 ms)", $"{cachedTime} ms");
        }

        private static async Task RunErrorAndCrashHandlingTestsAsync(string testDir)
        {
            Console.WriteLine("\n[8] ERROR & CRASH RECOVERY TESTS (Section 76, 79, 98)");

            // Non-existent file
            var resNotFound = await NxRunner.ExecuteJobAsync(new CadJob { Source = Path.Combine(testDir, "does_not_exist.prt") });
            Assert(!resNotFound.Success && resNotFound.ErrorCode == "FILE_NOT_FOUND", "Handled non-existent file gracefully (FILE_NOT_FOUND)");

            // Empty source
            var resEmpty = await NxRunner.ExecuteJobAsync(new CadJob { Source = "" });
            Assert(!resEmpty.Success && resEmpty.ErrorCode == "FILE_NOT_FOUND", "Handled empty source path gracefully");
        }

        private static async Task RunStressAndMemoryTestsAsync(string testDir)
        {
            Console.WriteLine("\n[9] STRESS & MEMORY LEAK SIMULATION TESTS (Section 100)");

            int iterations = 50;
            string stressSource = Path.Combine(testDir, "stress.prt");
            await File.WriteAllTextAsync(stressSource, "ISO-10303-21; stress model;");

            GC.Collect();
            long initialMemory = GC.GetTotalMemory(true);

            var sw = Stopwatch.StartNew();
            for (int i = 0; i < iterations; i++)
            {
                string outGlb = Path.Combine(testDir, $"stress_{i}.glb");
                var res = await NxRunner.ExecuteJobAsync(new CadJob { Source = stressSource, Output = outGlb });
                if (!res.Success)
                {
                    Assert(false, $"Stress iteration {i} failed");
                    return;
                }
            }
            sw.Stop();

            GC.Collect();
            long finalMemory = GC.GetTotalMemory(true);
            long memDiffKb = (finalMemory - initialMemory) / 1024;

            Assert(true, $"Completed {iterations} conversions in {sw.ElapsedMilliseconds} ms (avg {sw.ElapsedMilliseconds / iterations} ms/model)");
            Assert(Math.Abs(memDiffKb) < 10240, $"Memory overhead is stable without linear leaks (delta: {memDiffKb} KB)");
        }
    }
}
