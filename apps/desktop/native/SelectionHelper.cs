using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;

// Resident broker, reads only on explicit requests. No hooks, clipboard listener, OCR or password access.
internal static class SelectionHelper {
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern uint GetClipboardSequenceNumber();
    [DllImport("user32.dll")] static extern IntPtr GetClipboardOwner();
    [DllImport("user32.dll")] static extern bool OpenClipboard(IntPtr owner);
    [DllImport("user32.dll")] static extern bool CloseClipboard();
    [DllImport("user32.dll")] static extern uint EnumClipboardFormats(uint format);
    [DllImport("user32.dll")] static extern IntPtr GetClipboardData(uint format);
    [DllImport("user32.dll")] static extern IntPtr SetClipboardData(uint format, IntPtr data);
    [DllImport("user32.dll")] static extern bool EmptyClipboard();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr CreateWindowEx(uint exStyle, string className, string windowName, uint style, int x, int y, int width, int height, IntPtr parent, IntPtr menu, IntPtr instance, IntPtr parameter);
    [DllImport("user32.dll")] static extern bool DestroyWindow(IntPtr window);
    [DllImport("kernel32.dll")] static extern IntPtr GlobalAlloc(uint flags, UIntPtr bytes);
    [DllImport("kernel32.dll")] static extern IntPtr GlobalLock(IntPtr data);
    [DllImport("kernel32.dll")] static extern bool GlobalUnlock(IntPtr data);
    [DllImport("kernel32.dll")] static extern UIntPtr GlobalSize(IntPtr data);
    [DllImport("kernel32.dll")] static extern IntPtr GlobalFree(IntPtr data);
    [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, INPUT[] inputs, int size);
    [StructLayout(LayoutKind.Sequential)] struct INPUT { public uint type; public INPUTUNION data; }
    [StructLayout(LayoutKind.Explicit)] struct INPUTUNION {
        [FieldOffset(0)] public KEYBDINPUT keyboard;
        [FieldOffset(0)] public MOUSEINPUT mouse;
    }
    [StructLayout(LayoutKind.Sequential)] struct KEYBDINPUT { public ushort vk; public ushort scan; public uint flags; public uint time; public UIntPtr extra; }
    [StructLayout(LayoutKind.Sequential)] struct MOUSEINPUT { public int x; public int y; public uint mouseData; public uint flags; public uint time; public UIntPtr extra; }
    static INPUT Key(ushort key, bool up) { return new INPUT { type = 1, data = new INPUTUNION { keyboard = new KEYBDINPUT { vk = key, flags = up ? 2U : 0U } } }; }
    sealed class Request {
        public string Id, Source="windows", Category="unknown", Method="manual", Failure="none";
        public bool Fallback, Retire; public volatile bool Cancelled; public int ExcludePid, TriggerKey;
        public IntPtr Foreground; public uint Pid; public Stopwatch Clock=Stopwatch.StartNew();
        public long QueueMs,UiaMs,KeyMs,BackupMs,CopyMs,RestoreMs;
    }
    static readonly object requests=new object(), output=new object();
    static Request pending,active; static bool stopping;
    [ThreadStatic] static Request current;
    static IntPtr clipboardWindow;
    static object Result(string text,string method,string reason,string source) {
        if(current!=null) { current.Method=method; current.Failure=method!="manual"?"none":Failure(reason); }
        return new {text=text,method=method,reason=reason,source=source};
    }
    static string Failure(string reason) {
        if(reason.Contains("超时"))return "uia-timeout"; if(reason.Contains("受保护"))return "protected";
        if(reason.Contains("焦点"))return "focus-changed"; if(reason.Contains("20000"))return "too-long";
        if(reason.Contains("松开"))return "keys-held"; if(reason.Contains("恢复失败"))return "restore-failed";
        if(reason.Contains("被占用"))return "clipboard-busy"; if(reason.Contains("格式")||reason.Contains("备份"))return "clipboard-format";
        if(reason.Contains("剪贴板由")||reason.Contains("又有变化")||reason.Contains("剪贴板已变化"))return "clipboard-changed";
        if(reason.Contains("完整发送"))return "copy-failed"; if(reason.Contains("未产生"))return "copy-empty";
        if(reason.Contains("没有可读取"))return "no-window";return "no-selection";
    }
    static void Send(object value) {lock(output){Console.WriteLine(new JavaScriptSerializer().Serialize(value));Console.Out.Flush();}}
    static void Complete(Request request,object selection) {
        Send(new {type="result",id=request.Id,selection=selection,sourceCategory=request.Category,failure=request.Failure,
            stages=new {queueMs=request.QueueMs,uiaMs=request.UiaMs,keyReleaseMs=request.KeyMs,clipboardBackupMs=request.BackupMs,copyWaitMs=request.CopyMs,readRestoreMs=request.RestoreMs,totalMs=request.Clock.ElapsedMilliseconds}});
    }
    static object Cancelled(Request request) {request.Method="manual";request.Failure="superseded";return new {text="",method="manual",reason="已改为读取最新选区。",source=request.Source};}
    static bool Open() {var clock=Stopwatch.StartNew();do {if(clipboardWindow!=IntPtr.Zero&&OpenClipboard(clipboardWindow))return true;Thread.Sleep(5);}while(clock.ElapsedMilliseconds<80);return false;}
    [STAThread] static void Main(string[] args) {
        Console.InputEncoding=new UTF8Encoding(false);Console.OutputEncoding=new UTF8Encoding(false);
        if(args.Length!=1||args[0]!="--server")return;
        Send(new {type="ready"});var worker=new Thread(Work);worker.IsBackground=true;worker.SetApartmentState(ApartmentState.STA);worker.Start();
        string line;
        while((line=Console.ReadLine())!=null) {
            try {
                if(line.Length>4096)continue;var data=new JavaScriptSerializer().Deserialize<Dictionary<string,object>>(line);
                string id=(string)data["id"],type=(string)data["type"];Guid parsed;if(!Guid.TryParse(id,out parsed))continue;
                lock(requests) {
                    if(type=="cancel") {if(active!=null&&active.Id==id)active.Cancelled=true;if(pending!=null&&pending.Id==id){Complete(pending,Cancelled(pending));pending=null;}continue;}
                    if(type!="capture"||data.Count!=5)continue;
                    var next=new Request {Id=id,Fallback=(bool)data["clipboardFallback"],ExcludePid=Convert.ToInt32(data["excludeProcessId"]),TriggerKey=Convert.ToInt32(data["triggerKey"])};
                    if(next.ExcludePid<=0||next.TriggerKey<48||next.TriggerKey>90)continue;
                    next.Foreground=GetForegroundWindow();GetWindowThreadProcessId(next.Foreground,out next.Pid);
                    if(active!=null)active.Cancelled=true;if(pending!=null)Complete(pending,Cancelled(pending));pending=next;Monitor.Pulse(requests);
                }
            }catch { /* malformed internal requests never reach UIA or clipboard */ }
        }
        lock(requests){stopping=true;if(active!=null)active.Cancelled=true;pending=null;Monitor.Pulse(requests);}worker.Join(1000);
    }
    static void Work() {
        clipboardWindow=CreateWindowEx(0,"STATIC","Polar Vocab Clipboard Guard",0,0,0,0,0,new IntPtr(-3),IntPtr.Zero,IntPtr.Zero,IntPtr.Zero);
        // Warm the UIA assembly once without querying any selected text.
        var warm=new Thread(delegate(){try{var root=AutomationElement.RootElement;}catch{}});warm.IsBackground=true;warm.SetApartmentState(ApartmentState.STA);warm.Start();
        try {while(true){
            Request request;lock(requests){while(pending==null&&!stopping)Monitor.Wait(requests);if(stopping)return;request=pending;pending=null;active=request;}
            current=request;request.QueueMs=request.Clock.ElapsedMilliseconds;object result;
            try {result=request.Cancelled?Cancelled(request):Capture(request);}catch {result=Result("","manual","暂未取得选区，请直接输入或粘贴。",request.Source);}
            if(request.Cancelled)result=Cancelled(request);Complete(request,result);lock(requests){active=null;}current=null;
            // A timed-out UIA thread cannot contaminate a later request or accumulate in this broker.
            if(request.Retire)Environment.Exit(0);
        }}finally{if(clipboardWindow!=IntPtr.Zero)DestroyWindow(clipboardWindow);}
    }
    static bool KeysDown(Request request) {return (GetAsyncKeyState(0x11)&0x8000)!=0||(GetAsyncKeyState(0x12)&0x8000)!=0||(GetAsyncKeyState(0x10)&0x8000)!=0||(GetAsyncKeyState(request.TriggerKey)&0x8000)!=0;}
    static object Capture(Request request) {
        bool fallback=request.Fallback;IntPtr foreground=request.Foreground;var stage=Stopwatch.StartNew();
        if(request.Pid==request.ExcludePid||GetForegroundWindow()!=foreground)return Result("","manual","焦点已变化，请直接输入或粘贴。",request.Source);
        if (foreground == IntPtr.Zero) return Result("", "manual", "当前没有可读取的窗口。", "windows");
        uint pid; GetWindowThreadProcessId(foreground, out pid);
        if(pid!=request.Pid)return Result("","manual","焦点已变化，请直接输入或粘贴。",request.Source);
        string source = "windows";
        try { source += ":" + Process.GetProcessById((int)pid).ProcessName; } catch { }
        request.Source=source;string lower=source.ToLowerInvariant();request.Category=lower.Contains("notepad")?"notepad":lower.Contains("msedge")?"edge":lower.Contains("chrome")?"chrome":"other";string selected = "";
        bool safeFocus = false, password = false;
        Thread reader = new Thread(delegate() {
            try {
                AutomationElement element = AutomationElement.FocusedElement;
                if (element == null) return;
                var ancestors = new List<AutomationElement>();
                var root = AutomationElement.FromHandle(foreground);
                bool belongs = false;
                for (int i = 0; element != null && i < 24; i++) {
                    if (element.Current.IsPassword) { password = true; return; }
                    ancestors.Add(element);
                    if (element.Equals(root)) { belongs = true; break; }
                    element = TreeWalker.ControlViewWalker.GetParent(element);
                }
                if (!belongs) return;
                safeFocus = true;
                foreach (var current in ancestors) {
                    object pattern;
                    if (current.TryGetCurrentPattern(TextPattern.Pattern, out pattern)) {
                        var ranges = ((TextPattern)pattern).GetSelection();
                        foreach (var range in ranges) {
                            string candidate = range.GetText(20001);
                            if (!String.IsNullOrWhiteSpace(candidate)) { selected = candidate; return; }
                        }
                    }
                }
            } catch { safeFocus = false; }
        });
        reader.SetApartmentState(ApartmentState.STA); reader.IsBackground = true; reader.Start();
        bool completed = reader.Join(600);request.UiaMs=stage.ElapsedMilliseconds;stage.Restart();
        if (!completed) {request.Retire=true;return Result("", "manual", "应用的选区接口超时，请手动输入或粘贴。", source);}
        if(request.Cancelled)return Cancelled(request);if (password) return Result("", "manual", "受保护输入区域不会读取。", source);
        if (GetForegroundWindow() != foreground) return Result("", "manual", "焦点已变化，本次未使用旧窗口选区。", source);
        if(request.Cancelled)return Cancelled(request);
        if(GetForegroundWindow()!=foreground)return Result("","manual","焦点已变化，本次未使用旧窗口选区。",source);
        if (!String.IsNullOrWhiteSpace(selected)) {
            if (selected.Length > 20000) return Result("", "manual", "选区超过20000字符，请手动缩短；没有自动截断。", source);
            return Result(selected, "uia", "已通过Windows选区接口读取；未改动剪贴板。", source);
        }
        if (!fallback || !safeFocus) return Result("", "manual", "未取得安全选区，请手动输入或粘贴。", source);
        stage.Restart();while(KeysDown(request)&&stage.ElapsedMilliseconds<220&&!request.Cancelled)Thread.Sleep(5);request.KeyMs=stage.ElapsedMilliseconds;
        if(request.Cancelled)return Cancelled(request);if(KeysDown(request))return Result("","manual","请松开快捷键；本次未模拟复制。",source);
        if (GetForegroundWindow() != foreground) return Result("", "manual", "焦点已变化，本次未模拟复制。", source);
        stage.Restart();Dictionary<uint, byte[]> original = new Dictionary<uint, byte[]>();
        uint before;
        if (!Open()) return Result("", "manual", "剪贴板被占用，请手动粘贴。", source);
        try {
            before = GetClipboardSequenceNumber();
            uint format = 0;
            while ((format = EnumClipboardFormats(format)) != 0) {
                // Non-text/unknown formats cannot be restored losslessly by this helper.
                if (format != 1 && format != 7 && format != 13 && format != 16) return Result("", "manual", "原剪贴板含图片、富文本或其他格式，未模拟复制；请手动输入或粘贴。", source);
                IntPtr handle = GetClipboardData(format);
                ulong size = GlobalSize(handle).ToUInt64();
                if (size == 0 || size > 1024 * 1024) return Result("", "manual", "原剪贴板格式不可安全备份，本次未模拟复制。", source);
                IntPtr pointer = GlobalLock(handle);
                if (pointer == IntPtr.Zero) return Result("", "manual", "无法备份原剪贴板，本次未模拟复制。", source);
                try { var bytes = new byte[(int)size]; Marshal.Copy(pointer, bytes, 0, bytes.Length); original.Add(format, bytes); }
                finally { GlobalUnlock(handle); }
            }
        } finally { CloseClipboard(); }
        request.BackupMs=stage.ElapsedMilliseconds;if(request.Cancelled)return Cancelled(request);if (GetForegroundWindow() != foreground || GetClipboardSequenceNumber() != before) return Result("", "manual", "焦点或剪贴板已变化，本次未模拟复制。", source);
        var keys = new INPUT[] { Key(0x11, false), Key(0x43, false), Key(0x43, true), Key(0x11, true) };
        bool sent=SendInput((uint)keys.Length, keys, Marshal.SizeOf(typeof(INPUT))) == keys.Length;
        if (!sent) {
            var release = new INPUT[] { Key(0x43, true), Key(0x11, true) };
            SendInput((uint)release.Length, release, Marshal.SizeOf(typeof(INPUT)));
            return Result("", "manual", "复制输入未完整发送，已尝试释放本次按键；请手动输入。", source);
        }
        uint copied = before;stage.Restart();
        do {Thread.Sleep(5);copied=GetClipboardSequenceNumber();if(copied!=before)break;}while(stage.ElapsedMilliseconds<250);request.CopyMs=stage.ElapsedMilliseconds;stage.Restart();
        if (copied == before) return Result("", "manual", "复制未产生新剪贴板内容；旧剪贴板未作为选区使用。", source);
        uint ownerPid; GetWindowThreadProcessId(GetClipboardOwner(), out ownerPid);
        if (ownerPid != pid) return Result("", "manual", "剪贴板由其他进程修改，未读取或覆盖该内容。", source);
        bool restoreFailed = false;
        try {
            if (!Open()) return Result("", "manual", "剪贴板被占用，请检查复制结果后手动输入。", source);
            try {
                if (GetClipboardSequenceNumber() != copied) return Result("", "manual", "剪贴板又有变化，本次未读取。", source);
                IntPtr handle = GetClipboardData(13), pointer = GlobalLock(handle);
                if (pointer != IntPtr.Zero) { try { selected = Marshal.PtrToStringUni(pointer, (int)Math.Min(501UL, GlobalSize(handle).ToUInt64() / 2)).Split('\0')[0]; } finally { GlobalUnlock(handle); } }
            } finally { CloseClipboard(); }
        } finally {
            if (GetClipboardSequenceNumber() == copied) {
                if (Open()) {
                    try {
                        if (GetClipboardSequenceNumber() == copied) {
                            if (!EmptyClipboard()) restoreFailed = true;
                            else foreach (var item in original) {
                                IntPtr handle = GlobalAlloc(0x42, (UIntPtr)item.Value.Length), pointer = GlobalLock(handle);
                                if (pointer == IntPtr.Zero) { restoreFailed = true; if (handle != IntPtr.Zero) GlobalFree(handle); break; }
                                Marshal.Copy(item.Value, 0, pointer, item.Value.Length); GlobalUnlock(handle);
                                if (SetClipboardData(item.Key, handle) == IntPtr.Zero) { GlobalFree(handle); restoreFailed = true; break; }
                            }
                        }
                    } finally { CloseClipboard(); }
                } else restoreFailed = true;
            }
            foreach (var bytes in original.Values) Array.Clear(bytes, 0, bytes.Length);
        }
        request.RestoreMs=stage.ElapsedMilliseconds;if(request.Cancelled)return Cancelled(request);if (restoreFailed) return Result("", "manual", "复制后剪贴板恢复失败，请检查剪贴板并手动输入。", source);
        if (String.IsNullOrWhiteSpace(selected) || selected.Length > 20000) return Result("", "manual", "未取得20000字符以内的选区，请手动输入。", source);
        return Result(selected, "clipboard", "通过新复制序列取得选区，并恢复受支持的纯文本剪贴板格式。", source);
    }
}
