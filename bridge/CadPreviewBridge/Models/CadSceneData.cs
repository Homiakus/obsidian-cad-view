namespace CadPreviewBridge.Models
{
    public class CadSceneData
    {
        public string Name { get; set; } = "Scene";
        public string Units { get; set; } = "mm";
        public CadNode RootNode { get; set; } = new();
        public List<CadMeshData> Meshes { get; set; } = new();
        public List<CadMaterialData> Materials { get; set; } = new();
        public BoundingBox BoundingBox { get; set; } = new();
    }

    public class CadMeshData
    {
        public string Name { get; set; } = "Mesh";
        public float[] Positions { get; set; } = Array.Empty<float>();
        public float[] Normals { get; set; } = Array.Empty<float>();
        public uint[] Indices { get; set; } = Array.Empty<uint>();
        public int MaterialIndex { get; set; } = 0;
    }

    public class CadMaterialData
    {
        public string Name { get; set; } = "Material";
        public float[] DiffuseColor { get; set; } = [0.7f, 0.75f, 0.8f, 1.0f]; // RGBA
        public float Roughness { get; set; } = 0.4f;
        public float Metallic { get; set; } = 0.2f;
        public float Opacity { get; set; } = 1.0f;
    }
}
