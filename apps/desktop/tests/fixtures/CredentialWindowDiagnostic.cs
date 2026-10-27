using System;
using System.Collections.Generic;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Forms;
using System.Web.Script.Serialization;

// Component-test fixture only: no credential controls, vault, network or user data.
// Observes its own window without driving any application or authentication UI.
internal static class CredentialWindowDiagnostic {
    [DllImport("user32.dll")]
    static extern bool IsWindowVisible(IntPtr window);

    [STAThread]
    static void Main() {
        var utf8 = new UTF8Encoding(false);
        string request;
        using (var input = new StreamReader(Console.OpenStandardInput(), utf8)) request = input.ReadToEnd();
        var json = new JavaScriptSerializer();
        var command = json.Deserialize<Dictionary<string, object>>(request);
        object target;
        string receivedTarget = command.TryGetValue("target", out target) ? target as string : null;
        bool hold = request.IndexOf("diagnostic-hold", StringComparison.Ordinal) >= 0;
        bool shown = false, nativeVisible = false;
        Application.EnableVisualStyles();
        using (var form = new Form())
        using (var timer = new Timer()) {
            form.Text = "Polar Vocab GUI startup diagnostic - no credentials";
            form.ClientSize = new System.Drawing.Size(320, 80);
            form.ShowInTaskbar = false;
            form.StartPosition = FormStartPosition.CenterScreen;
            form.Shown += delegate { shown = true; };
            timer.Interval = hold ? 20000 : 180;
            timer.Tick += delegate {
                nativeVisible = IsWindowVisible(form.Handle);
                timer.Stop(); form.Close();
            };
            timer.Start(); form.ShowDialog();
        }
        using (var output = new StreamWriter(Console.OpenStandardOutput(), utf8)) {
            output.Write(json.Serialize(new { ok = true, found = false, value = json.Serialize(new { shown, nativeVisible, receivedTarget }) }));
        }
    }
}
