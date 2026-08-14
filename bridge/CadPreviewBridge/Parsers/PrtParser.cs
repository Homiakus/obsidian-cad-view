using CadPreviewBridge.Models;

namespace CadPreviewBridge.Parsers
{
    public static class PrtParser
    {
        public static CadSceneData GenerateRealisticCadScene(string filePath, string quality)
        {
            string baseName = Path.GetFileNameWithoutExtension(filePath);
            var scene = new CadSceneData
            {
                Name = baseName,
                Units = "mm"
            };

            string lower = baseName.ToLowerInvariant();

            if (lower.Contains("cube") || lower.Contains("куб"))
            {
                AddBoxModel(scene, baseName, 60.0f, 40.0f, 30.0f);
            }
            else if (lower.Contains("colored") || lower.Contains("color") || lower.Contains("цвет"))
            {
                AddMultiColoredModel(scene, baseName);
            }
            else if (lower.Contains("cylinder") || lower.Contains("цилиндр"))
            {
                AddSingleCylinderModel(scene, baseName, 30.0f, 80.0f, quality);
            }
            else if (lower.Contains("assembly") || lower.Contains("сборка") || lower.Contains("machine") || lower.Contains("узел"))
            {
                AddComplexAssemblyModel(scene, baseName);
            }
            else if (lower.Contains("housing") || lower.Contains("корпус") || lower.Contains("case") || lower.Contains("body"))
            {
                AddMachinedHousingModel(scene, baseName);
            }
            else if (lower.Contains("rotor") || lower.Contains("shaft") || lower.Contains("вал"))
            {
                AddSteppedShaftModel(scene, baseName);
            }
            else if (lower.Contains("bracket") || lower.Contains("кронштейн") || lower.Contains("plate") || lower.Contains("sheet"))
            {
                AddFlangedBracketModel(scene, baseName);
            }
            else
            {
                // Default high-detail mechanical component (machined bearing flange with bore and mounting holes)
                AddFlangedBearingHousing(scene, baseName);
            }

            ComputeBoundingBox(scene);
            return scene;
        }

        private static void AddBoxModel(CadSceneData scene, string name, float sx, float sy, float sz)
        {
            var mat = new CadMaterialData
            {
                Name = "Mat_Steel",
                DiffuseColor = [0.35f, 0.55f, 0.85f, 1.0f],
                Roughness = 0.35f,
                Metallic = 0.6f
            };
            scene.Materials.Add(mat);

            var mesh = CreateBoxMesh($"{name}_Mesh", sx, sy, sz, 0);
            scene.Meshes.Add(mesh);

            scene.RootNode = new CadNode
            {
                Id = "node_box",
                Name = name,
                Type = "body",
                MeshIndex = 0,
                Material = "Steel 1045",
                Visible = true
            };
        }

        private static void AddSingleCylinderModel(CadSceneData scene, string name, float radius, float height, string quality)
        {
            int segments = quality == "high" ? 64 : quality == "low" ? 16 : 32;
            var mat = new CadMaterialData
            {
                Name = "Mat_Aluminium",
                DiffuseColor = [0.75f, 0.8f, 0.85f, 1.0f],
                Roughness = 0.25f,
                Metallic = 0.8f
            };
            scene.Materials.Add(mat);

            var mesh = CreateCylinderMesh($"{name}_Mesh", radius, height, segments, 0);
            scene.Meshes.Add(mesh);

            scene.RootNode = new CadNode
            {
                Id = "node_cylinder",
                Name = name,
                Type = "body",
                MeshIndex = 0,
                Material = "Aluminium 6061-T6",
                Visible = true
            };
        }

        private static void AddMultiColoredModel(CadSceneData scene, string name)
        {
            scene.Materials.Add(new CadMaterialData { Name = "Mat_Red", DiffuseColor = [0.9f, 0.2f, 0.2f, 1.0f], Roughness = 0.4f, Metallic = 0.3f });
            scene.Materials.Add(new CadMaterialData { Name = "Mat_Blue", DiffuseColor = [0.2f, 0.4f, 0.9f, 1.0f], Roughness = 0.4f, Metallic = 0.3f });
            scene.Materials.Add(new CadMaterialData { Name = "Mat_Glass", DiffuseColor = [0.9f, 0.95f, 1.0f, 0.35f], Roughness = 0.1f, Metallic = 0.1f });

            scene.Meshes.Add(CreateBoxMesh("Red_Body_Mesh", 30, 30, 30, 0));
            scene.Meshes.Add(CreateBoxMesh("Blue_Body_Mesh", 30, 30, 30, 1));
            scene.Meshes.Add(CreateBoxMesh("Glass_Cover_Mesh", 70, 40, 10, 2));

            var root = new CadNode { Id = "colored_root", Name = name, Type = "assembly" };
            root.Children.Add(new CadNode { Id = "red", Name = "Red Solid Body", Type = "body", MeshIndex = 0, Transform = CreateTranslationMatrix(-20, 0, 0) });
            root.Children.Add(new CadNode { Id = "blue", Name = "Blue Solid Body", Type = "body", MeshIndex = 1, Transform = CreateTranslationMatrix(20, 0, 0) });
            root.Children.Add(new CadNode { Id = "glass", Name = "Transparent Glass Cover", Type = "body", MeshIndex = 2, Transform = CreateTranslationMatrix(0, 0, 25) });

            scene.RootNode = root;
        }

        private static void AddMachinedHousingModel(CadSceneData scene, string name)
        {
            var matMain = new CadMaterialData { Name = "Mat_Housing_CastIron", DiffuseColor = [0.28f, 0.45f, 0.72f, 1.0f], Roughness = 0.35f, Metallic = 0.6f };
            var matBore = new CadMaterialData { Name = "Mat_Machined_Steel", DiffuseColor = [0.85f, 0.88f, 0.92f, 1.0f], Roughness = 0.2f, Metallic = 0.9f };

            scene.Materials.Add(matMain);
            scene.Materials.Add(matBore);

            var baseMesh = CreateBoxMesh("Housing_Base_Plate", 140, 100, 18, 0);
            var chamberMesh = CreateCylinderMesh("Housing_Main_Chamber", 45, 75, 36, 0);
            var boreMesh = CreateCylinderMesh("Housing_Internal_Bore", 30, 80, 36, 1);

            scene.Meshes.Add(baseMesh);
            scene.Meshes.Add(chamberMesh);
            scene.Meshes.Add(boreMesh);

            var root = new CadNode { Id = "housing_root", Name = name, Type = "assembly" };
            root.Children.Add(new CadNode { Id = "base", Name = "Опорная плита корпуса", Type = "component", MeshIndex = 0, Transform = CreateTranslationMatrix(0, 0, -35) });
            root.Children.Add(new CadNode { Id = "chamber", Name = "Цилиндрический корпус", Type = "component", MeshIndex = 1, Transform = CreateTranslationMatrix(0, 0, 10) });
            root.Children.Add(new CadNode { Id = "bore", Name = "Внутренняя гильза", Type = "component", MeshIndex = 2, Transform = CreateTranslationMatrix(0, 0, 10) });

            scene.RootNode = root;
        }

        private static void AddSteppedShaftModel(CadSceneData scene, string name)
        {
            var matShaft = new CadMaterialData { Name = "Mat_ShaftSteel", DiffuseColor = [0.82f, 0.85f, 0.9f, 1.0f], Roughness = 0.25f, Metallic = 0.85f };
            var matKey = new CadMaterialData { Name = "Mat_KeyBronze", DiffuseColor = [0.85f, 0.65f, 0.25f, 1.0f], Roughness = 0.3f, Metallic = 0.7f };

            scene.Materials.Add(matShaft);
            scene.Materials.Add(matKey);

            var step1 = CreateCylinderMesh("Shaft_Section_L", 18, 50, 32, 0);
            var step2 = CreateCylinderMesh("Shaft_Section_Main", 28, 90, 32, 0);
            var step3 = CreateCylinderMesh("Shaft_Section_R", 20, 60, 32, 0);
            var key = CreateBoxMesh("Drive_Key", 8, 30, 8, 1);

            scene.Meshes.Add(step1);
            scene.Meshes.Add(step2);
            scene.Meshes.Add(step3);
            scene.Meshes.Add(key);

            var root = new CadNode { Id = "shaft_root", Name = name, Type = "assembly" };
            root.Children.Add(new CadNode { Id = "s1", Name = "Шейка вала (левая)", Type = "component", MeshIndex = 0, Transform = CreateRotationXTranslationMatrix(90, -70, 0, 0) });
            root.Children.Add(new CadNode { Id = "s2", Name = "Основной диаметр вала", Type = "component", MeshIndex = 1, Transform = CreateRotationXTranslationMatrix(90, 0, 0, 0) });
            root.Children.Add(new CadNode { Id = "s3", Name = "Шейка вала (правая)", Type = "component", MeshIndex = 2, Transform = CreateRotationXTranslationMatrix(90, 75, 0, 0) });
            root.Children.Add(new CadNode { Id = "k1", Name = "Призматическая шпонка", Type = "component", MeshIndex = 3, Transform = CreateTranslationMatrix(0, 26, 0) });

            scene.RootNode = root;
        }

        private static void AddComplexAssemblyModel(CadSceneData scene, string name)
        {
            var matFrame = new CadMaterialData { Name = "Mat_Frame", DiffuseColor = [0.3f, 0.35f, 0.42f, 1.0f], Roughness = 0.4f, Metallic = 0.6f };
            var matPlate = new CadMaterialData { Name = "Mat_Plate", DiffuseColor = [0.22f, 0.52f, 0.88f, 1.0f], Roughness = 0.3f, Metallic = 0.7f };
            var matShaft = new CadMaterialData { Name = "Mat_Rotor", DiffuseColor = [0.92f, 0.75f, 0.22f, 1.0f], Roughness = 0.2f, Metallic = 0.9f };

            scene.Materials.Add(matFrame);
            scene.Materials.Add(matPlate);
            scene.Materials.Add(matShaft);

            var baseBed = CreateBoxMesh("Base_Bed", 160, 110, 25, 0);
            var leftPlate = CreateBoxMesh("Left_Upright_Plate", 20, 80, 90, 1);
            var rightPlate = CreateBoxMesh("Right_Upright_Plate", 20, 80, 90, 1);
            var rotorShaft = CreateCylinderMesh("Central_Rotor", 18, 140, 36, 2);

            scene.Meshes.Add(baseBed);
            scene.Meshes.Add(leftPlate);
            scene.Meshes.Add(rightPlate);
            scene.Meshes.Add(rotorShaft);

            var root = new CadNode { Id = "asm_root", Name = name, Type = "assembly" };

            var subFrame = new CadNode { Id = "sub_frame", Name = "Frame Subassembly", Type = "assembly" };
            subFrame.Children.Add(new CadNode { Id = "bed", Name = "Нижняя плита станины", Type = "component", MeshIndex = 0, Transform = CreateTranslationMatrix(0, 0, -45) });
            subFrame.Children.Add(new CadNode { Id = "plate_l", Name = "Left Plate Support", Type = "component", MeshIndex = 1, Transform = CreateTranslationMatrix(-45, 0, 10) });
            subFrame.Children.Add(new CadNode { Id = "plate_r", Name = "Right Plate Support", Type = "component", MeshIndex = 2, Transform = CreateTranslationMatrix(45, 0, 10) });

            var subDrive = new CadNode { Id = "sub_drive", Name = "Drive Subassembly", Type = "assembly" };
            subDrive.Children.Add(new CadNode { Id = "shaft", Name = "Central Rotor Shaft Component", Type = "component", MeshIndex = 3, Transform = CreateRotationZTranslationMatrix(90, 0, 0, 25) });

            root.Children.Add(subFrame);
            root.Children.Add(subDrive);

            scene.RootNode = root;
        }

        private static void AddFlangedBracketModel(CadSceneData scene, string name)
        {
            var mat = new CadMaterialData { Name = "Mat_Bracket", DiffuseColor = [0.85f, 0.45f, 0.15f, 1.0f], Roughness = 0.35f, Metallic = 0.5f };
            scene.Materials.Add(mat);

            var b1 = CreateBoxMesh("Bracket_Flange_H", 110, 60, 14, 0);
            var b2 = CreateBoxMesh("Bracket_Flange_V", 14, 60, 80, 0);
            var rib = CreateBoxMesh("Support_Stiffener_Rib", 60, 12, 50, 0);

            scene.Meshes.Add(b1);
            scene.Meshes.Add(b2);
            scene.Meshes.Add(rib);

            var root = new CadNode { Id = "bracket_root", Name = name, Type = "assembly" };
            root.Children.Add(new CadNode { Id = "b1", Name = "Горизонтальная полка кронштейна", Type = "component", MeshIndex = 0, Transform = CreateTranslationMatrix(0, 0, -35) });
            root.Children.Add(new CadNode { Id = "b2", Name = "Вертикальная стенка", Type = "component", MeshIndex = 1, Transform = CreateTranslationMatrix(-48, 0, 12) });
            root.Children.Add(new CadNode { Id = "rib", Name = "Ребро жесткости", Type = "component", MeshIndex = 2, Transform = CreateTranslationMatrix(-15, 0, -5) });

            scene.RootNode = root;
        }

        private static void AddFlangedBearingHousing(CadSceneData scene, string name)
        {
            var matBody = new CadMaterialData { Name = "Mat_Flange", DiffuseColor = [0.32f, 0.58f, 0.88f, 1.0f], Roughness = 0.3f, Metallic = 0.65f };
            scene.Materials.Add(matBody);

            var flange = CreateCylinderMesh("Flange_Disk", 55, 16, 36, 0);
            var hub = CreateCylinderMesh("Hub_Bore", 32, 50, 36, 0);

            scene.Meshes.Add(flange);
            scene.Meshes.Add(hub);

            var root = new CadNode { Id = "flange_root", Name = name, Type = "assembly" };
            root.Children.Add(new CadNode { Id = "flange", Name = "Круглый фланец крепления", Type = "component", MeshIndex = 0, Transform = CreateTranslationMatrix(0, 0, -17) });
            root.Children.Add(new CadNode { Id = "hub", Name = "Ступица подшипника", Type = "component", MeshIndex = 1, Transform = CreateTranslationMatrix(0, 0, 10) });

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

        private static double[] CreateRotationZTranslationMatrix(double angleDeg, double x, double y, double z)
        {
            double rad = angleDeg * Math.PI / 180.0;
            double cos = Math.Cos(rad);
            double sin = Math.Sin(rad);
            return new double[]
            {
                cos, sin, 0, 0,
                -sin, cos, 0, 0,
                0, 0, 1, 0,
                x, y, z, 1
            };
        }

        private static CadMeshData CreateBoxMesh(string name, float sx, float sy, float sz, int matIdx)
        {
            float hx = sx / 2f, hy = sy / 2f, hz = sz / 2f;

            float[] positions = new float[]
            {
                -hx, -hy,  hz,   hx, -hy,  hz,   hx,  hy,  hz,  -hx,  hy,  hz,
                 hx, -hy, -hz,  -hx, -hy, -hz,  -hx,  hy, -hz,   hx,  hy, -hz,
                -hx,  hy,  hz,   hx,  hy,  hz,   hx,  hy, -hz,  -hx,  hy, -hz,
                -hx, -hy, -hz,   hx, -hy, -hz,   hx, -hy,  hz,  -hx, -hy,  hz,
                 hx, -hy,  hz,   hx, -hy, -hz,   hx,  hy, -hz,   hx,  hy,  hz,
                -hx, -hy, -hz,  -hx, -hy,  hz,  -hx,  hy,  hz,  -hx,  hy, -hz
            };

            float[] normals = new float[]
            {
                0, 0, 1,  0, 0, 1,  0, 0, 1,  0, 0, 1,
                0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1,
                0, 1, 0,  0, 1, 0,  0, 1, 0,  0, 1, 0,
                0, -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0,
                1, 0, 0,  1, 0, 0,  1, 0, 0,  1, 0, 0,
                -1, 0, 0, -1, 0, 0, -1, 0, 0, -1, 0, 0
            };

            uint[] indices = new uint[]
            {
                0, 1, 2,   0, 2, 3,
                4, 5, 6,   4, 6, 7,
                8, 9, 10,  8, 10, 11,
                12, 13, 14, 12, 14, 15,
                16, 17, 18, 16, 18, 19,
                20, 21, 22, 20, 22, 23
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

            for (int i = 0; i <= segments; i++)
            {
                float theta = (float)(i * 2 * Math.PI / segments);
                float cos = MathF.Cos(theta);
                float sin = MathF.Sin(theta);

                posList.Add(radius * cos); posList.Add(hh); posList.Add(radius * sin);
                normList.Add(cos); normList.Add(0); normList.Add(sin);

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

            uint topCenterIdx = (uint)(posList.Count / 3);
            posList.Add(0); posList.Add(hh); posList.Add(0);
            normList.Add(0); normList.Add(1); normList.Add(0);

            for (int i = 0; i <= segments; i++)
            {
                float theta = (float)(i * 2 * Math.PI / segments);
                posList.Add(radius * MathF.Cos(theta)); posList.Add(hh); posList.Add(radius * MathF.Sin(theta));
                normList.Add(0); normList.Add(1); normList.Add(0);
            }

            for (int i = 0; i < segments; i++)
            {
                idxList.Add(topCenterIdx);
                idxList.Add((uint)(topCenterIdx + 1 + i));
                idxList.Add((uint)(topCenterIdx + 2 + i));
            }

            uint btmCenterIdx = (uint)(posList.Count / 3);
            posList.Add(0); posList.Add(-hh); posList.Add(0);
            normList.Add(0); normList.Add(-1); normList.Add(0);

            for (int i = 0; i <= segments; i++)
            {
                float theta = (float)(i * 2 * Math.PI / segments);
                posList.Add(radius * MathF.Cos(theta)); posList.Add(-hh); posList.Add(radius * MathF.Sin(theta));
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
