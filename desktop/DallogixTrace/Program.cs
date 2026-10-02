using System;
using System.Drawing;
using Microsoft.Web.WebView2.WinForms;
using Microsoft.Web.WebView2.Core;
using System.Diagnostics;
using System.IO;
using System.Net.Http;
using System.Text;
using System.Threading.Tasks;
using System.Windows.Forms;

namespace DallogixTrace;

internal static class Program
{
    [STAThread]
    static void Main()
    {
        ApplicationConfiguration.Initialize();
        Application.Run(new TraceForm());
    }
}

internal sealed class TraceForm : Form
{
    private const string TraceUrl = "http://127.0.0.1:8080";
    private readonly WebView2 web = new() { Dock = DockStyle.Fill };

    public TraceForm()
    {
        Text = "Dallogix Trace";
        WindowState = FormWindowState.Maximized;
        FormBorderStyle = FormBorderStyle.None;
        Controls.Add(web);
        Shown += async (_, _) => await StartAsync();
    }

    private async Task StartAsync()
    {
        var root = AppContext.BaseDirectory;
        var compose = Path.Combine(root, "docker-compose.yml");
        if (!File.Exists(compose)) { ShowFailure("Instalação incompleta: docker-compose.yml não encontrado."); return; }
        try
        {
            var docker = FindDockerCli();
            await EnsureDockerEngineAsync(docker, root);
            var composeResult = await RunProcessAsync(docker, "compose --profile industrial up -d", root);
            if (composeResult.ExitCode != 0)
            {
                ShowFailure($"Não foi possível iniciar os serviços do Trace. {composeResult.Error.Trim()}");
                return;
            }
            using var client = new HttpClient { Timeout = TimeSpan.FromSeconds(3) };
            var activationError = "nenhuma resposta da API";
            for (var attempt = 0; attempt < 30; attempt++)
            {
                try
                {
                    using var response = await client.GetAsync($"{TraceUrl}/api/ativacao_local.php");
                    if (response.IsSuccessStatusCode) break;
                    activationError = $"HTTP {(int)response.StatusCode} ({response.StatusCode})";
                }
                catch (Exception error) { activationError = error.Message; }
                await Task.Delay(2000);
                if (attempt == 29) { ShowFailure($"A API de ativação local não ficou pronta. Confira as migrations e os logs do PHP/MySQL. Último erro: {activationError}"); return; }
            }
            var webViewOptions = new CoreWebView2EnvironmentOptions(
                "--disable-smooth-scrolling --disable-features=ElasticOverscroll"
            );
            var webViewEnvironment = await CoreWebView2Environment.CreateAsync(
                browserExecutableFolder: null,
                userDataFolder: null,
                options: webViewOptions
            );
            await web.EnsureCoreWebView2Async(webViewEnvironment);
            web.CoreWebView2.Settings.AreDevToolsEnabled = false;
            web.CoreWebView2.Settings.AreDefaultContextMenusEnabled = false;
            web.CoreWebView2.Settings.AreBrowserAcceleratorKeysEnabled = false;
            web.CoreWebView2.Navigate(TraceUrl);
        }
        catch (Exception error) { ShowFailure($"Não foi possível iniciar o Trace. {error.Message}"); }
    }

    private static string FindDockerCli()
    {
        var candidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Docker", "Docker", "resources", "bin", "docker.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "DockerDesktop", "resources", "bin", "docker.exe"),
            "docker.exe",
        };
        foreach (var candidate in candidates)
        {
            if (candidate.Equals("docker.exe", StringComparison.OrdinalIgnoreCase) || File.Exists(candidate)) return candidate;
        }
        throw new FileNotFoundException("Docker Desktop não foi encontrado.");
    }

    private static async Task EnsureDockerEngineAsync(string docker, string workingDirectory)
    {
        var check = await RunProcessAsync(docker, "info --format \"{{.OSType}}\"", workingDirectory);
        if (check.ExitCode == 0 && check.Output.Trim().Equals("linux", StringComparison.OrdinalIgnoreCase)) return;

        var desktopCandidates = new[]
        {
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ProgramFiles), "Docker", "Docker", "Docker Desktop.exe"),
            Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Programs", "DockerDesktop", "Docker Desktop.exe"),
        };
        var desktop = Array.Find(desktopCandidates, File.Exists);
        if (desktop != null) Process.Start(new ProcessStartInfo(desktop) { UseShellExecute = true });

        for (var attempt = 0; attempt < 60; attempt++)
        {
            await Task.Delay(TimeSpan.FromSeconds(2));
            check = await RunProcessAsync(docker, "info --format \"{{.OSType}}\"", workingDirectory);
            if (check.ExitCode == 0 && check.Output.Trim().Equals("linux", StringComparison.OrdinalIgnoreCase)) return;
        }
        throw new InvalidOperationException("O Docker Desktop não iniciou o mecanismo Linux a tempo.");
    }

    private static async Task<(int ExitCode, string Output, string Error)> RunProcessAsync(string fileName, string arguments, string workingDirectory)
    {
        using var process = new Process
        {
            StartInfo = new ProcessStartInfo
            {
                FileName = fileName,
                Arguments = arguments,
                WorkingDirectory = workingDirectory,
                UseShellExecute = false,
                CreateNoWindow = true,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                StandardOutputEncoding = Encoding.UTF8,
                StandardErrorEncoding = Encoding.UTF8,
            },
        };
        process.Start();
        var output = process.StandardOutput.ReadToEndAsync();
        var error = process.StandardError.ReadToEndAsync();
        await process.WaitForExitAsync();
        return (process.ExitCode, await output, await error);
    }

    private void ShowFailure(string message)
    {
        Controls.Clear();
        Controls.Add(new Label { Dock = DockStyle.Fill, Text = message, TextAlign = ContentAlignment.MiddleCenter, Font = new Font("Segoe UI", 18), ForeColor = Color.White, BackColor = Color.FromArgb(16, 34, 46) });
    }
}
