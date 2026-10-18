using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;
using System.Windows.Automation;

// On-demand only. No hooks, continuous clipboard listener, OCR or password access.
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
    static object Result(string text, string method, string reason, string source) { return new { text = text, method = method, reason = reason, source = source }; }
    static IntPtr clipboardWindow;
    static bool Open() { for (int i = 0; i < 12; i++) { if (clipboardWindow != IntPtr.Zero && OpenClipboard(clipboardWindow)) return true; Thread.Sleep(15); } return false; }

    [STAThread] static void Main(string[] args) {
        Console.OutputEncoding = new UTF8Encoding(false);
        object result;
        try { clipboardWindow = CreateWindowEx(0, "STATIC", "Polar Vocab Clipboard Guard", 0, 0, 0, 0, 0, new IntPtr(-3), IntPtr.Zero, IntPtr.Zero, IntPtr.Zero); result = Capture(args.Length == 1 && args[0] == "copy-fallback"); }
        catch { result = Result("", "manual", "无法安全读取选区，请手动输入或粘贴。", "windows"); }
        finally { if (clipboardWindow != IntPtr.Zero) DestroyWindow(clipboardWindow); }
        Console.WriteLine(new JavaScriptSerializer().Serialize(result));
    }
    static object Capture(bool fallback) {
        IntPtr foreground = GetForegroundWindow();
        if (foreground == IntPtr.Zero) return Result("", "manual", "当前没有可读取的窗口。", "windows");
        uint pid; GetWindowThreadProcessId(foreground, out pid);
        string source = "windows";
        try { source += ":" + Process.GetProcessById((int)pid).ProcessName; } catch { }
        string selected = "";
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
        bool completed = reader.Join(1200);
        if (!completed) return Result("", "manual", "应用的选区接口超时，请手动输入或粘贴。", source);
        if (password) return Result("", "manual", "受保护输入区域不会读取。", source);
        if (GetForegroundWindow() != foreground) return Result("", "manual", "焦点已变化，本次未使用旧窗口选区。", source);
        if (!String.IsNullOrWhiteSpace(selected)) {
            if (selected.Trim().Length > 500) return Result("", "manual", "选区超过500字符，请手动缩短；没有自动截断。", source);
            return Result(selected.Trim(), "uia", "已通过Windows选区接口读取；未改动剪贴板。", source);
        }
        if (!fallback || !safeFocus) return Result("", "manual", "未取得安全选区，请手动输入或粘贴。", source);
        for (int wait = 0; wait < 40 && ((GetAsyncKeyState(0x11) & 0x8000) != 0 || (GetAsyncKeyState(0x12) & 0x8000) != 0 || (GetAsyncKeyState(0x10) & 0x8000) != 0); wait++) Thread.Sleep(20);
        if ((GetAsyncKeyState(0x11) & 0x8000) != 0 || (GetAsyncKeyState(0x12) & 0x8000) != 0 || (GetAsyncKeyState(0x10) & 0x8000) != 0) return Result("", "manual", "请松开快捷键；本次未模拟复制。", source);
        if (GetForegroundWindow() != foreground) return Result("", "manual", "焦点已变化，本次未模拟复制。", source);
        Dictionary<uint, byte[]> original = new Dictionary<uint, byte[]>();
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
        if (GetForegroundWindow() != foreground || GetClipboardSequenceNumber() != before) return Result("", "manual", "焦点或剪贴板已变化，本次未模拟复制。", source);
        var keys = new INPUT[] { Key(0x11, false), Key(0x43, false), Key(0x43, true), Key(0x11, true) };
        if (SendInput((uint)keys.Length, keys, Marshal.SizeOf(typeof(INPUT))) != keys.Length) {
            var release = new INPUT[] { Key(0x43, true), Key(0x11, true) };
            SendInput((uint)release.Length, release, Marshal.SizeOf(typeof(INPUT)));
            return Result("", "manual", "复制输入未完整发送，已尝试释放本次按键；请手动输入。", source);
        }
        uint copied = before;
        for (int i = 0; i < 40; i++) { Thread.Sleep(20); copied = GetClipboardSequenceNumber(); if (copied != before) break; }
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
        if (restoreFailed) return Result("", "manual", "复制后剪贴板恢复失败，请检查剪贴板并手动输入。", source);
        if (String.IsNullOrWhiteSpace(selected) || selected.Trim().Length > 500) return Result("", "manual", "未取得500字符以内的选区，请手动输入。", source);
        return Result(selected.Trim(), "clipboard", "通过新复制序列取得选区，并恢复受支持的纯文本剪贴板格式。", source);
    }
}
