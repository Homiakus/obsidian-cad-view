using System.Text.Json.Serialization;

namespace CadPreviewBridge.Models
{
    public class CadJob
    {
        [JsonPropertyName("jobId")]
        public string JobId { get; set; } = Guid.NewGuid().ToString("N")[..8];

        [JsonPropertyName("source")]
        public string Source { get; set; } = string.Empty;

        [JsonPropertyName("output")]
        public string Output { get; set; } = string.Empty;

        [JsonPropertyName("quality")]
        public string Quality { get; set; } = "normal"; // draft, normal, high, ultra

        [JsonPropertyName("includeAssemblyTree")]
        public bool IncludeAssemblyTree { get; set; } = true;

        [JsonPropertyName("includeColors")]
        public bool IncludeColors { get; set; } = true;

        [JsonPropertyName("includeAttributes")]
        public bool IncludeAttributes { get; set; } = true;

        [JsonPropertyName("includePMI")]
        public bool IncludePMI { get; set; } = false;

        [JsonPropertyName("nxPath")]
        public string? NxPath { get; set; }

        [JsonPropertyName("timeoutSeconds")]
        public int TimeoutSeconds { get; set; } = 120;
    }

    public class ConversionResult
    {
        [JsonPropertyName("success")]
        public bool Success { get; set; }

        [JsonPropertyName("jobId")]
        public string? JobId { get; set; }

        [JsonPropertyName("glbPath")]
        public string? GlbPath { get; set; }

        [JsonPropertyName("metadataPath")]
        public string? MetadataPath { get; set; }

        [JsonPropertyName("errorCode")]
        public string? ErrorCode { get; set; }

        [JsonPropertyName("errorMessage")]
        public string? ErrorMessage { get; set; }

        [JsonPropertyName("durationMs")]
        public long DurationMs { get; set; }

        [JsonPropertyName("metadata")]
        public CadMetadata? Metadata { get; set; }
    }

    public class CadMetadata
    {
        [JsonPropertyName("source")]
        public string Source { get; set; } = string.Empty;

        [JsonPropertyName("format")]
        public string Format { get; set; } = string.Empty; // prt, step, stp, jt

        [JsonPropertyName("units")]
        public string Units { get; set; } = "mm";

        [JsonPropertyName("generatedAt")]
        public string GeneratedAt { get; set; } = DateTime.UtcNow.ToString("o");

        [JsonPropertyName("sourceMtime")]
        public long SourceMtime { get; set; }

        [JsonPropertyName("sourceSize")]
        public long SourceSize { get; set; }

        [JsonPropertyName("converterVersion")]
        public int ConverterVersion { get; set; } = 1;

        [JsonPropertyName("nxVersion")]
        public string? NxVersion { get; set; }

        [JsonPropertyName("componentCount")]
        public int ComponentCount { get; set; }

        [JsonPropertyName("bodyCount")]
        public int BodyCount { get; set; }

        [JsonPropertyName("triangleCount")]
        public int TriangleCount { get; set; }

        [JsonPropertyName("boundingBox")]
        public BoundingBox? BoundingBox { get; set; }

        [JsonPropertyName("assemblyTree")]
        public CadNode? AssemblyTree { get; set; }
    }

    public class BoundingBox
    {
        [JsonPropertyName("min")]
        public double[] Min { get; set; } = [0, 0, 0];

        [JsonPropertyName("max")]
        public double[] Max { get; set; } = [0, 0, 0];

        [JsonPropertyName("size")]
        public double[] Size { get; set; } = [0, 0, 0];
    }

    public class CadNode
    {
        [JsonPropertyName("id")]
        public string Id { get; set; } = Guid.NewGuid().ToString("N");

        [JsonPropertyName("name")]
        public string Name { get; set; } = "Node";

        [JsonPropertyName("nxId")]
        public string? NxId { get; set; }

        [JsonPropertyName("type")]
        public string Type { get; set; } = "component"; // assembly, component, body

        [JsonPropertyName("transform")]
        public double[]? Transform { get; set; } // 16-element 4x4 matrix (column-major or row-major)

        [JsonPropertyName("visible")]
        public bool Visible { get; set; } = true;

        [JsonPropertyName("color")]
        public double[]? Color { get; set; } // [r, g, b, a]

        [JsonPropertyName("material")]
        public string? Material { get; set; }

        [JsonPropertyName("density")]
        public double? Density { get; set; }

        [JsonPropertyName("mass")]
        public double? Mass { get; set; }

        [JsonPropertyName("children")]
        public List<CadNode> Children { get; set; } = new();

        [JsonPropertyName("meshIndex")]
        public int? MeshIndex { get; set; }
    }
}
