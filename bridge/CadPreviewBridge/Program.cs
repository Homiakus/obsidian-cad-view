using System.Text.Json;
using CadPreviewBridge.Models;

namespace CadPreviewBridge
{
    public class Program
    {
        public static async Task<int> Main(string[] args)
        {
            if (args.Length == 0 || args[0] is "-h" or "--help" or "help")
            {
                PrintHelp();
                return 0;
            }

            string command = args[0].ToLowerInvariant();

            try
            {
                switch (command)
                {
                    case "convert":
                        return await HandleConvertAsync(args[1..]);

                    case "inspect":
                        return await HandleInspectAsync(args[1..]);

                    case "test-nx":
                        return HandleTestNx(args[1..]);

                    case "daemon":
                        return await HandleDaemonAsync();

                    case "generate-test-models":
                        return await HandleGenerateTestModelsAsync(args[1..]);

                    default:
                        // Default shorthand: cad-preview input.prt output.glb
                        if (File.Exists(args[0]) || args[0].EndsWith(".prt", StringComparison.OrdinalIgnoreCase) ||
                            args[0].EndsWith(".step", StringComparison.OrdinalIgnoreCase) ||
                            args[0].EndsWith(".stp", StringComparison.OrdinalIgnoreCase) ||
                            args[0].EndsWith(".jt", StringComparison.OrdinalIgnoreCase))
                        {
                            return await HandleConvertAsync(args);
                        }

                        Console.Error.WriteLine($"Unknown command: {command}");
                        PrintHelp();
                        return 1;
                }
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"Fatal bridge error: {ex.Message}\n{ex.StackTrace}");
                return 99;
            }
        }

        private static void PrintHelp()
        {
            Console.WriteLine("Obsidian CAD Preview Bridge (Siemens NX PRT / STEP / JT -> GLB)");
            Console.WriteLine("Usage:");
            Console.WriteLine("  cad-preview convert <source> [--output <output.glb>] [--quality <draft|normal|high|ultra>] [--nx-path <path>]");
            Console.WriteLine("  cad-preview inspect <source>");
            Console.WriteLine("  cad-preview test-nx [--nx-path <path>]");
            Console.WriteLine("  cad-preview daemon");
            Console.WriteLine("  cad-preview generate-test-models [--outdir <path>]");
        }

        private static async Task<int> HandleConvertAsync(string[] args)
        {
            if (args.Length == 0)
            {
                Console.Error.WriteLine("Error: Source CAD file path required.");
                return 1;
            }

            var job = new CadJob { Source = Path.GetFullPath(args[0]) };

            for (int i = 1; i < args.Length; i++)
            {
                if (args[i] is "--output" or "-o" && i + 1 < args.Length)
                {
                    job.Output = Path.GetFullPath(args[++i]);
                }
                else if (args[i] is "--quality" or "-q" && i + 1 < args.Length)
                {
                    job.Quality = args[++i];
                }
                else if (args[i] is "--nx-path" or "-nx" && i + 1 < args.Length)
                {
                    job.NxPath = args[++i];
                }
                else if (args[i] is "--timeout" && i + 1 < args.Length && int.TryParse(args[++i], out int t))
                {
                    job.TimeoutSeconds = t;
                }
                else if (args[i].EndsWith(".glb", StringComparison.OrdinalIgnoreCase))
                {
                    job.Output = Path.GetFullPath(args[i]);
                }
            }

            if (string.IsNullOrEmpty(job.Output))
            {
                job.Output = Path.ChangeExtension(job.Source, ".glb");
            }

            var result = await NxRunner.ExecuteJobAsync(job);
            string jsonOut = JsonSerializer.Serialize(result, new JsonSerializerOptions { WriteIndented = true });
            Console.WriteLine(jsonOut);

            return result.Success ? 0 : 2;
        }

        private static async Task<int> HandleInspectAsync(string[] args)
        {
            if (args.Length == 0)
            {
                Console.Error.WriteLine("Error: CAD file path required.");
                return 1;
            }

            string path = Path.GetFullPath(args[0]);
            if (!File.Exists(path))
            {
                Console.Error.WriteLine($"File not found: {path}");
                return 1;
            }

            var fi = new FileInfo(path);
            var inspectData = new Dictionary<string, object>
            {
                ["fileName"] = fi.Name,
                ["fullPath"] = fi.FullName,
                ["extension"] = fi.Extension,
                ["sizeBytes"] = fi.Length,
                ["lastModified"] = fi.LastWriteTimeUtc.ToString("o")
            };

            Console.WriteLine(JsonSerializer.Serialize(inspectData, new JsonSerializerOptions { WriteIndented = true }));
            return 0;
        }

        private static int HandleTestNx(string[] args)
        {
            string? explicitPath = null;
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] is "--nx-path" or "-nx" && i + 1 < args.Length)
                {
                    explicitPath = args[++i];
                }
            }

            var info = NxDetector.Detect(explicitPath);
            string jsonOut = JsonSerializer.Serialize(info, new JsonSerializerOptions { WriteIndented = true });
            Console.WriteLine(jsonOut);

            if (info.IsFound)
            {
                Console.Error.WriteLine($"✓ Siemens NX detected ({info.Version})");
                Console.Error.WriteLine($"  Path: {info.BaseDir}");
                Console.Error.WriteLine($"  Detection source: {info.DetectionSource}");
                Console.Error.WriteLine($"  Batch execution: {(info.BatchExecutionAvailable ? "Available" : "Unavailable")}");
                return 0;
            }
            else
            {
                Console.Error.WriteLine("✗ Siemens NX not found in standard paths or registry.");
                return 1;
            }
        }

        private static async Task<int> HandleDaemonAsync()
        {
            Console.Error.WriteLine("[CAD_DAEMON] Persistent CAD Bridge worker started. Listening on STDIN...");

            var nxInfo = NxDetector.Detect();

            while (true)
            {
                string? line = await Console.In.ReadLineAsync();
                if (line == null) break; // EOF

                line = line.Trim();
                if (string.IsNullOrEmpty(line)) continue;

                if (line.Equals("exit", StringComparison.OrdinalIgnoreCase) || line.Equals("quit", StringComparison.OrdinalIgnoreCase))
                {
                    break;
                }

                if (line.Equals("ping", StringComparison.OrdinalIgnoreCase))
                {
                    Console.WriteLine("{\"status\":\"pong\"}");
                    continue;
                }

                try
                {
                    var job = JsonSerializer.Deserialize<CadJob>(line);
                    if (job != null)
                    {
                        var result = await NxRunner.ExecuteJobAsync(job, nxInfo);
                        Console.WriteLine(JsonSerializer.Serialize(result));
                    }
                }
                catch (Exception ex)
                {
                    var errRes = new ConversionResult
                    {
                        Success = false,
                        ErrorCode = "JOB_PARSE_ERROR",
                        ErrorMessage = ex.Message
                    };
                    Console.WriteLine(JsonSerializer.Serialize(errRes));
                }
            }

            return 0;
        }

        private static async Task<int> HandleGenerateTestModelsAsync(string[] args)
        {
            string outDir = Path.Combine(Directory.GetCurrentDirectory(), "tests", "models");
            for (int i = 0; i < args.Length; i++)
            {
                if (args[i] is "--outdir" or "-o" && i + 1 < args.Length)
                {
                    outDir = Path.GetFullPath(args[++i]);
                }
            }

            if (!Directory.Exists(outDir))
            {
                Directory.CreateDirectory(outDir);
            }

            var modelNames = new[]
            {
                "cube.prt",
                "cylinder.prt",
                "sheet.prt",
                "colored.prt",
                "assembly-simple.prt",
                "assembly-nested.prt",
                "assembly-transformed.prt",
                "part.step",
                "assembly.step",
                "sample.jt"
            };

            Console.WriteLine($"Generating test suite models in {outDir}...");

            foreach (var model in modelNames)
            {
                string filePath = Path.Combine(outDir, model);
                // Create dummy raw source file
                string dummyContent = $"ISO-10303-21; /* Synthetic CAD test model {model} */ END-ISO-10303-21;";
                await File.WriteAllTextAsync(filePath, dummyContent);

                // Export matching GLB & Metadata
                string glbPath = Path.Combine(outDir, Path.ChangeExtension(model, ".glb"));
                var job = new CadJob
                {
                    Source = filePath,
                    Output = glbPath,
                    Quality = "normal"
                };
                var res = await NxRunner.ExecuteJobAsync(job);
                Console.WriteLine($"  [TEST_MODEL] {model} -> {(res.Success ? "OK" : "FAILED")} ({res.DurationMs}ms)");
            }

            Console.WriteLine("Test models generated successfully.");
            return 0;
        }
    }
}
