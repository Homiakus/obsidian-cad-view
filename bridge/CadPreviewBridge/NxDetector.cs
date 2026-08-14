using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text.RegularExpressions;
using Microsoft.Win32;

namespace CadPreviewBridge
{
    public class NxInfo
    {
        public bool IsFound { get; set; }
        public string? BaseDir { get; set; }
        public string? UgiiDir { get; set; }
        public string? RunJournalExe { get; set; }
        public string? UgrafExe { get; set; }
        public string? Version { get; set; }
        public bool SupportsPrt { get; set; }
        public bool SupportsStep { get; set; }
        public bool SupportsJt { get; set; }
        public bool BatchExecutionAvailable { get; set; }
        public string? DetectionSource { get; set; }
    }

    public static class NxDetector
    {
        public static NxInfo Detect(string? explicitPath = null)
        {
            var info = new NxInfo();

            // 1. Explicit user path
            if (!string.IsNullOrWhiteSpace(explicitPath))
            {
                if (TryValidateNxDir(explicitPath, "User Setting", out info))
                {
                    return info;
                }
            }

            // 2. Environment Variables
            string? ugiiBase = Environment.GetEnvironmentVariable("UGII_BASE_DIR");
            if (!string.IsNullOrWhiteSpace(ugiiBase) && TryValidateNxDir(ugiiBase, "Environment (UGII_BASE_DIR)", out info))
            {
                return info;
            }

            string? ugiiRoot = Environment.GetEnvironmentVariable("UGII_ROOT_DIR");
            if (!string.IsNullOrWhiteSpace(ugiiRoot))
            {
                var parent = Directory.GetParent(ugiiRoot.TrimEnd('\\', '/'))?.FullName;
                if (!string.IsNullOrEmpty(parent) && TryValidateNxDir(parent, "Environment (UGII_ROOT_DIR)", out info))
                {
                    return info;
                }
            }

            string? nxDir = Environment.GetEnvironmentVariable("NX_DIR") ?? Environment.GetEnvironmentVariable("SIEMENS_NX_DIR");
            if (!string.IsNullOrWhiteSpace(nxDir) && TryValidateNxDir(nxDir, "Environment (NX_DIR)", out info))
            {
                return info;
            }

            // 3. Registry (Windows only)
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            {
                if (TryDetectFromRegistry(out info))
                {
                    return info;
                }
            }

            // 4. Standard Program Files search
            var standardDrives = new[] { "C:", "D:", "E:" };
            foreach (var drive in standardDrives)
            {
                if (!Directory.Exists(drive)) continue;

                var searchFolders = new[]
                {
                    Path.Combine(drive, "Program Files", "Siemens"),
                    Path.Combine(drive, "Siemens"),
                    Path.Combine(drive, "Program Files (x86)", "Siemens")
                };

                foreach (var folder in searchFolders)
                {
                    if (!Directory.Exists(folder)) continue;

                    try
                    {
                        var nxDirs = Directory.GetDirectories(folder, "NX*")
                            .OrderByDescending(d => d); // Prefer newest

                        foreach (var dir in nxDirs)
                        {
                            if (TryValidateNxDir(dir, $"Standard Path ({dir})", out info))
                            {
                                return info;
                            }
                        }
                    }
                    catch
                    {
                        // Ignore permission/scan errors
                    }
                }
            }

            info.IsFound = false;
            return info;
        }

        private static bool TryDetectFromRegistry(out NxInfo info)
        {
            info = new NxInfo();
            try
            {
                var registryKeys = new[]
                {
                    @"SOFTWARE\Siemens\NX",
                    @"SOFTWARE\Unigraphics Solutions\NX",
                    @"SOFTWARE\WOW6432Node\Siemens\NX"
                };

                foreach (var regKeyPath in registryKeys)
                {
                    using var baseKey = Registry.LocalMachine.OpenSubKey(regKeyPath);
                    if (baseKey == null) continue;

                    var subKeyNames = baseKey.GetSubKeyNames().OrderByDescending(s => s);
                    foreach (var subKeyName in subKeyNames)
                    {
                        using var versionKey = baseKey.OpenSubKey(subKeyName);
                        if (versionKey == null) continue;

                        var installDir = versionKey.GetValue("UGII_BASE_DIR") as string 
                                      ?? versionKey.GetValue("InstallDir") as string
                                      ?? versionKey.GetValue("Path") as string;

                        if (!string.IsNullOrEmpty(installDir) && TryValidateNxDir(installDir, $"Registry ({regKeyPath}\\{subKeyName})", out info))
                        {
                            return true;
                        }
                    }
                }
            }
            catch
            {
                // Ignore registry access errors
            }

            return false;
        }

        private static bool TryValidateNxDir(string dirPath, string detectionSource, out NxInfo info)
        {
            info = new NxInfo();
            if (string.IsNullOrWhiteSpace(dirPath) || !Directory.Exists(dirPath))
            {
                return false;
            }

            string baseDir = Path.GetFullPath(dirPath);
            string ugiiDir = Path.Combine(baseDir, "UGII");

            if (!Directory.Exists(ugiiDir))
            {
                // Maybe the user specified UGII directly
                if (Path.GetFileName(baseDir.TrimEnd('\\', '/')).Equals("UGII", StringComparison.OrdinalIgnoreCase))
                {
                    ugiiDir = baseDir;
                    baseDir = Directory.GetParent(ugiiDir)?.FullName ?? baseDir;
                }
                else
                {
                    return false;
                }
            }

            string runJournal = Path.Combine(ugiiDir, "run_journal.exe");
            string ugraf = Path.Combine(ugiiDir, "ugraf.exe");
            string nxbinDir = Path.Combine(baseDir, "NXBIN");
            string ugtopv = Path.Combine(nxbinDir, "ugtopv.exe");

            if (!File.Exists(runJournal) && Directory.Exists(nxbinDir))
            {
                string nxbinJournal = Path.Combine(nxbinDir, "run_journal.exe");
                if (File.Exists(nxbinJournal)) runJournal = nxbinJournal;
            }

            if (!File.Exists(ugraf) && Directory.Exists(nxbinDir))
            {
                string nxbinUgraf = Path.Combine(nxbinDir, "ugraf.exe");
                if (File.Exists(nxbinUgraf)) ugraf = nxbinUgraf;
            }

            // Look for version clues in folder name, ugraf version info, or UGII
            string folderName = Path.GetFileName(baseDir);
            string version = "Siemens NX";

            if (File.Exists(ugraf))
            {
                try
                {
                    var vi = FileVersionInfo.GetVersionInfo(ugraf);
                    if (!string.IsNullOrEmpty(vi.FileVersion))
                    {
                        version = $"NX {vi.FileVersion}";
                    }
                    else if (!string.IsNullOrEmpty(vi.ProductVersion))
                    {
                        version = $"NX {vi.ProductVersion}";
                    }
                }
                catch { }
            }

            if (version == "Siemens NX")
            {
                var versionMatch = Regex.Match(folderName, @"NX\s*(\d+(\.\d+)?)", RegexOptions.IgnoreCase);
                version = versionMatch.Success ? $"NX {versionMatch.Groups[1].Value}" : "Siemens NX";
            }

            info.IsFound = File.Exists(ugraf) || File.Exists(runJournal) || Directory.Exists(ugiiDir) || Directory.Exists(nxbinDir);
            info.BaseDir = baseDir;
            info.UgiiDir = ugiiDir;
            info.RunJournalExe = File.Exists(runJournal) ? runJournal : null;
            info.UgrafExe = File.Exists(ugraf) ? ugraf : null;
            info.Version = version;
            info.SupportsPrt = true;
            info.SupportsStep = true;
            info.SupportsJt = true;
            info.BatchExecutionAvailable = info.RunJournalExe != null || info.UgrafExe != null || File.Exists(ugtopv);
            info.DetectionSource = detectionSource;

            return info.IsFound;
        }
    }
}
