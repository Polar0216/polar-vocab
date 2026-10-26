using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;
using System.Text;
using System.Text.RegularExpressions;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Current-user Windows Credential Manager only. No files, network, shell or logs.
internal static class CredentialHelper {
    const uint Generic = 1, LocalMachine = 2;
    const int NotFound = 1168;
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
    struct Credential {
        public uint Flags, Type;
        public string TargetName, Comment;
        public System.Runtime.InteropServices.ComTypes.FILETIME LastWritten;
        public uint CredentialBlobSize;
        public IntPtr CredentialBlob;
        public uint Persist, AttributeCount;
        public IntPtr Attributes;
        public string TargetAlias, UserName;
    }
    [DllImport("advapi32.dll", EntryPoint = "CredReadW", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool Read(string target, uint type, uint flags, out IntPtr credential);
    [DllImport("advapi32.dll", EntryPoint = "CredWriteW", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool Write(ref Credential credential, uint flags);
    [DllImport("advapi32.dll", EntryPoint = "CredDeleteW", CharSet = CharSet.Unicode, SetLastError = true)]
    static extern bool Delete(string target, uint type, uint flags);
    [DllImport("advapi32.dll")] static extern void CredFree(IntPtr pointer);

    static readonly JavaScriptSerializer Json = new JavaScriptSerializer { MaxJsonLength = 8192 };
    static string Text(Dictionary<string, object> input, string key) { object value; return input.TryGetValue(key, out value) ? value as string : null; }
    static void Output(object value) { Console.Out.Write(Json.Serialize(value)); Console.Out.Flush(); }
    static bool KeyAllowed(string key) { return key != null && Regex.IsMatch(key, @"\APolarVocab\.Capture\.GitHub\.v1\.[a-f0-9]{64}\z"); }
    static string Prompt(string target) {
        Application.EnableVisualStyles();
        using (var form = new Form())
        using (var password = new TextBox())
        using (var ok = new Button())
        using (var cancel = new Button())
        using (var heading = new Label())
        using (var hint = new Label()) {
            form.Text = "Polar Vocab — GitHub 授权";
            form.ClientSize = new System.Drawing.Size(520, 238);
            form.FormBorderStyle = FormBorderStyle.FixedDialog;
            form.StartPosition = FormStartPosition.CenterScreen;
            form.MinimizeBox = false; form.MaximizeBox = false; form.TopMost = true;
            heading.Text = "仅连接此私有目标：\n" + target;
            heading.SetBounds(22, 18, 476, 54);
            hint.Text = "请输入 Fine-grained PAT（不会发送给网页界面）。\n仅授权目标仓库 Contents 读写；不要发送到聊天。";
            hint.SetBounds(22, 80, 476, 40);
            password.SetBounds(22, 130, 476, 26);
            password.UseSystemPasswordChar = true; password.MaxLength = 512;
            ok.Text = "测试连接"; ok.SetBounds(302, 180, 92, 34);
            cancel.Text = "取消"; cancel.SetBounds(406, 180, 92, 34); cancel.DialogResult = DialogResult.Cancel;
            string selected = null;
            ok.Click += delegate {
                if (password.Text.Trim().Length < 10) { hint.Text = "凭证长度不正确，请检查后重试。"; return; }
                selected = password.Text.Trim(); password.Text = ""; form.DialogResult = DialogResult.OK; form.Close();
            };
            form.Controls.AddRange(new Control[] { heading, hint, password, ok, cancel });
            form.AcceptButton = ok; form.CancelButton = cancel;
            var result = form.ShowDialog(); password.Text = "";
            return result == DialogResult.OK ? selected : null;
        }
    }
    [STAThread]
    static void Main(string[] args) {
        Console.InputEncoding = new UTF8Encoding(false); Console.OutputEncoding = new UTF8Encoding(false);
        try {
            if (args.Length != 0) { Output(new { ok = false, code = "invalid-request" }); return; }
            var text = new StringBuilder(); var buffer = new char[256]; int count;
            while ((count = Console.In.Read(buffer, 0, buffer.Length)) > 0) {
                text.Append(buffer, 0, count); Array.Clear(buffer, 0, buffer.Length);
                if (text.Length > 4096) { Output(new { ok = false, code = "invalid-request" }); return; }
            }
            var input = Json.Deserialize<Dictionary<string, object>>(text.ToString()); text.Clear();
            string op = Text(input, "op"), key = Text(input, "key");
            if (op == "prompt") {
                string target = Text(input, "target");
                if (target == null || target.Length > 420 || target.IndexOf('\0') >= 0) { Output(new { ok = false, code = "invalid-request" }); return; }
                var secret = Prompt(target); Output(new { ok = true, found = secret != null, value = secret }); return;
            }
            if (!KeyAllowed(key)) { Output(new { ok = false, code = "invalid-request" }); return; }
            if (op == "read") {
                IntPtr pointer;
                if (!Read(key, Generic, 0, out pointer)) {
                    if (Marshal.GetLastWin32Error() == NotFound) Output(new { ok = true, found = false });
                    else Output(new { ok = false, code = "windows-vault-unavailable", win32 = Marshal.GetLastWin32Error() });
                    return;
                }
                try {
                    var credential = (Credential)Marshal.PtrToStructure(pointer, typeof(Credential));
                    if (credential.Type != Generic || credential.CredentialBlobSize > 2560) { Output(new { ok = false, code = "invalid-record" }); return; }
                    var bytes = new byte[credential.CredentialBlobSize];
                    try { Marshal.Copy(credential.CredentialBlob, bytes, 0, bytes.Length); Output(new { ok = true, found = true, value = new UTF8Encoding(false, true).GetString(bytes) }); }
                    finally { Array.Clear(bytes, 0, bytes.Length); }
                } finally { CredFree(pointer); }
                return;
            }
            if (op == "write") {
                string value = Text(input, "value");
                if (value == null) { Output(new { ok = false, code = "invalid-request" }); return; }
                var bytes = new UTF8Encoding(false, true).GetBytes(value);
                IntPtr pointer = IntPtr.Zero;
                try {
                    if (bytes.Length > 2560) { Output(new { ok = false, code = "invalid-request" }); return; }
                    pointer = Marshal.AllocHGlobal(bytes.Length); Marshal.Copy(bytes, 0, pointer, bytes.Length);
                    var credential = new Credential { Type = Generic, TargetName = key, Comment = "Polar Vocab Capture — remembered GitHub authorization", CredentialBlobSize = (uint)bytes.Length, CredentialBlob = pointer, Persist = LocalMachine, UserName = "PolarVocabCapture" };
                    Output(Write(ref credential, 0) ? (object)new { ok = true } : new { ok = false, code = "windows-vault-unavailable" });
                } finally { if (pointer != IntPtr.Zero) { for (int i = 0; i < bytes.Length; i++) Marshal.WriteByte(pointer, i, 0); Marshal.FreeHGlobal(pointer); } Array.Clear(bytes, 0, bytes.Length); }
                return;
            }
            if (op == "delete") {
                bool deleted = Delete(key, Generic, 0);
                if (deleted || Marshal.GetLastWin32Error() == NotFound) Output(new { ok = true });
                else Output(new { ok = false, code = "windows-vault-unavailable" });
                return;
            }
            Output(new { ok = false, code = "invalid-request" });
        } catch { Output(new { ok = false, code = "credential-operation-failed" }); }
    }
}
