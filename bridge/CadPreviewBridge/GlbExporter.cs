using System.Text;
using System.Text.Json;
using CadPreviewBridge.Models;

namespace CadPreviewBridge
{
    public static class GlbExporter
    {
        public static void Export(CadSceneData scene, string glbFilePath)
        {
            var dir = Path.GetDirectoryName(glbFilePath);
            if (!string.IsNullOrEmpty(dir) && !Directory.Exists(dir))
            {
                Directory.CreateDirectory(dir);
            }

            using var binStream = new MemoryStream();
            using var binWriter = new BinaryWriter(binStream);

            var bufferViews = new List<Dictionary<string, object>>();
            var accessors = new List<Dictionary<string, object>>();
            var gltfMeshes = new List<Dictionary<string, object>>();
            var gltfMaterials = new List<Dictionary<string, object>>();
            var gltfNodes = new List<Dictionary<string, object>>();

            // 1. Build Materials
            if (scene.Materials.Count == 0)
            {
                scene.Materials.Add(new CadMaterialData());
            }

            for (int i = 0; i < scene.Materials.Count; i++)
            {
                var mat = scene.Materials[i];
                var pbr = new Dictionary<string, object>
                {
                    ["baseColorFactor"] = mat.DiffuseColor,
                    ["metallicFactor"] = mat.Metallic,
                    ["roughnessFactor"] = mat.Roughness
                };

                var matDict = new Dictionary<string, object>
                {
                    ["name"] = mat.Name,
                    ["pbrMetallicRoughness"] = pbr,
                    ["doubleSided"] = true
                };

                if (mat.Opacity < 0.999f)
                {
                    matDict["alphaMode"] = "BLEND";
                }

                gltfMaterials.Add(matDict);
            }

            // 2. Build Meshes & Accessors
            for (int m = 0; m < scene.Meshes.Count; m++)
            {
                var mesh = scene.Meshes[m];
                if (mesh.Positions.Length == 0 || mesh.Indices.Length == 0)
                {
                    continue;
                }

                // --- POSITIONS ---
                long posOffset = binStream.Position;
                float minX = float.MaxValue, minY = float.MaxValue, minZ = float.MaxValue;
                float maxX = float.MinValue, maxY = float.MinValue, maxZ = float.MinValue;

                for (int p = 0; p < mesh.Positions.Length; p += 3)
                {
                    float x = mesh.Positions[p];
                    float y = mesh.Positions[p + 1];
                    float z = mesh.Positions[p + 2];

                    if (x < minX) minX = x;
                    if (y < minY) minY = y;
                    if (z < minZ) minZ = z;

                    if (x > maxX) maxX = x;
                    if (y > maxY) maxY = y;
                    if (z > maxZ) maxZ = z;

                    binWriter.Write(x);
                    binWriter.Write(y);
                    binWriter.Write(z);
                }

                long posLength = binStream.Position - posOffset;
                int posBufferViewIndex = bufferViews.Count;
                bufferViews.Add(new Dictionary<string, object>
                {
                    ["buffer"] = 0,
                    ["byteOffset"] = (int)posOffset,
                    ["byteLength"] = (int)posLength,
                    ["target"] = 34962 // ARRAY_BUFFER
                });

                int posAccessorIndex = accessors.Count;
                accessors.Add(new Dictionary<string, object>
                {
                    ["bufferView"] = posBufferViewIndex,
                    ["byteOffset"] = 0,
                    ["componentType"] = 5126, // FLOAT
                    ["count"] = mesh.Positions.Length / 3,
                    ["type"] = "VEC3",
                    ["max"] = new[] { maxX, maxY, maxZ },
                    ["min"] = new[] { minX, minY, minZ }
                });

                // Align to 4 bytes
                Pad4(binStream, binWriter);

                // --- NORMALS ---
                int? normAccessorIndex = null;
                if (mesh.Normals.Length > 0 && mesh.Normals.Length == mesh.Positions.Length)
                {
                    long normOffset = binStream.Position;
                    for (int n = 0; n < mesh.Normals.Length; n++)
                    {
                        binWriter.Write(mesh.Normals[n]);
                    }
                    long normLength = binStream.Position - normOffset;

                    int normBufferViewIndex = bufferViews.Count;
                    bufferViews.Add(new Dictionary<string, object>
                    {
                        ["buffer"] = 0,
                        ["byteOffset"] = (int)normOffset,
                        ["byteLength"] = (int)normLength,
                        ["target"] = 34962
                    });

                    normAccessorIndex = accessors.Count;
                    accessors.Add(new Dictionary<string, object>
                    {
                        ["bufferView"] = normBufferViewIndex,
                        ["byteOffset"] = 0,
                        ["componentType"] = 5126, // FLOAT
                        ["count"] = mesh.Normals.Length / 3,
                        ["type"] = "VEC3"
                    });

                    Pad4(binStream, binWriter);
                }

                // --- INDICES ---
                long idxOffset = binStream.Position;
                uint maxIdx = 0;
                for (int idx = 0; idx < mesh.Indices.Length; idx++)
                {
                    uint val = mesh.Indices[idx];
                    if (val > maxIdx) maxIdx = val;
                    binWriter.Write(val);
                }
                long idxLength = binStream.Position - idxOffset;

                int idxBufferViewIndex = bufferViews.Count;
                bufferViews.Add(new Dictionary<string, object>
                {
                    ["buffer"] = 0,
                    ["byteOffset"] = (int)idxOffset,
                    ["byteLength"] = (int)idxLength,
                    ["target"] = 34963 // ELEMENT_ARRAY_BUFFER
                });

                int idxAccessorIndex = accessors.Count;
                accessors.Add(new Dictionary<string, object>
                {
                    ["bufferView"] = idxBufferViewIndex,
                    ["byteOffset"] = 0,
                    ["componentType"] = 5125, // UNSIGNED_INT
                    ["count"] = mesh.Indices.Length,
                    ["type"] = "SCALAR",
                    ["max"] = new[] { maxIdx },
                    ["min"] = new[] { 0 }
                });

                Pad4(binStream, binWriter);

                // Build Primitive
                var attributes = new Dictionary<string, object>
                {
                    ["POSITION"] = posAccessorIndex
                };
                if (normAccessorIndex.HasValue)
                {
                    attributes["NORMAL"] = normAccessorIndex.Value;
                }

                var primitive = new Dictionary<string, object>
                {
                    ["attributes"] = attributes,
                    ["indices"] = idxAccessorIndex,
                    ["material"] = Math.Clamp(mesh.MaterialIndex, 0, scene.Materials.Count - 1),
                    ["mode"] = 4 // TRIANGLES
                };

                gltfMeshes.Add(new Dictionary<string, object>
                {
                    ["name"] = mesh.Name,
                    ["primitives"] = new[] { primitive }
                });
            }

            // 3. Build Nodes Hierarchy
            int rootNodeIndex = BuildGltfNodes(scene.RootNode, gltfNodes);

            // 4. Build JSON structure
            var gltf = new Dictionary<string, object>
            {
                ["asset"] = new Dictionary<string, object>
                {
                    ["version"] = "2.0",
                    ["generator"] = "Obsidian CAD Preview Bridge (Siemens NX NXOpen)"
                },
                ["scenes"] = new[]
                {
                    new Dictionary<string, object>
                    {
                        ["name"] = scene.Name,
                        ["nodes"] = new[] { rootNodeIndex }
                    }
                },
                ["scene"] = 0,
                ["nodes"] = gltfNodes,
                ["meshes"] = gltfMeshes,
                ["materials"] = gltfMaterials,
                ["accessors"] = accessors,
                ["bufferViews"] = bufferViews,
                ["buffers"] = new[]
                {
                    new Dictionary<string, object>
                    {
                        ["byteLength"] = (int)binStream.Length
                    }
                }
            };

            byte[] jsonBytes = JsonSerializer.SerializeToUtf8Bytes(gltf, new JsonSerializerOptions { WriteIndented = false });
            int jsonPadding = (4 - (jsonBytes.Length % 4)) % 4;
            int jsonChunkLength = jsonBytes.Length + jsonPadding;

            byte[] binBytes = binStream.ToArray();
            int binPadding = (4 - (binBytes.Length % 4)) % 4;
            int binChunkLength = binBytes.Length + binPadding;

            int totalLength = 12 + 8 + jsonChunkLength + 8 + binChunkLength;

            // Write GLB file
            using var fileStream = File.Create(glbFilePath);
            using var writer = new BinaryWriter(fileStream);

            // GLB Header
            writer.Write(0x46546C67); // "glTF"
            writer.Write(2);          // version 2
            writer.Write(totalLength);

            // JSON Chunk Header
            writer.Write(jsonChunkLength);
            writer.Write(0x4E4F534A); // "JSON"
            writer.Write(jsonBytes);
            for (int i = 0; i < jsonPadding; i++) writer.Write((byte)0x20); // space padding

            // BIN Chunk Header
            writer.Write(binChunkLength);
            writer.Write(0x004E4942); // "BIN\0"
            writer.Write(binBytes);
            for (int i = 0; i < binPadding; i++) writer.Write((byte)0x00); // null padding
        }

        private static int BuildGltfNodes(CadNode node, List<Dictionary<string, object>> gltfNodes)
        {
            int currentIndex = gltfNodes.Count;
            var nodeDict = new Dictionary<string, object>
            {
                ["name"] = node.Name
            };

            // Extras metadata
            var extras = new Dictionary<string, object>
            {
                ["id"] = node.Id,
                ["type"] = node.Type,
                ["visible"] = node.Visible
            };
            if (!string.IsNullOrEmpty(node.NxId)) extras["nxId"] = node.NxId;
            if (!string.IsNullOrEmpty(node.Material)) extras["material"] = node.Material;
            if (node.Mass.HasValue) extras["mass"] = node.Mass.Value;
            nodeDict["extras"] = extras;

            if (node.MeshIndex.HasValue)
            {
                nodeDict["mesh"] = node.MeshIndex.Value;
            }

            if (node.Transform != null && node.Transform.Length == 16)
            {
                nodeDict["matrix"] = node.Transform;
            }

            gltfNodes.Add(nodeDict);

            var childrenIndices = new List<int>();
            foreach (var child in node.Children)
            {
                int childIndex = BuildGltfNodes(child, gltfNodes);
                childrenIndices.Add(childIndex);
            }

            if (childrenIndices.Count > 0)
            {
                nodeDict["children"] = childrenIndices.ToArray();
            }

            return currentIndex;
        }

        private static void Pad4(MemoryStream stream, BinaryWriter writer)
        {
            long rem = stream.Position % 4;
            if (rem != 0)
            {
                int pad = (int)(4 - rem);
                for (int i = 0; i < pad; i++)
                {
                    writer.Write((byte)0);
                }
            }
        }
    }
}
