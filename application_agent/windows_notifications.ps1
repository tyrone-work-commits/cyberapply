$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
$payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
$applicationsUrl = 'https://cyberapply-internal.covenda-1182.chatgpt.site/workspace?view=applications'
if ($payload.url -cne $applicationsUrl -or @($payload.items).Count -gt 10) { throw 'Invalid notification destination or batch.' }
$applicationId = 'Covenda.CyberApply'
$shortcutPath = Join-Path ([Environment]::GetFolderPath('Programs')) 'CyberApply notifications.lnk'
$explorerPath = Join-Path $env:WINDIR 'explorer.exe'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
if ((Test-Path -LiteralPath $shortcutPath) -and ($shortcut.TargetPath -ine $explorerPath -or $shortcut.Arguments -cne $applicationsUrl)) { throw 'An unrelated shortcut already exists.' }
$shortcut.TargetPath = $explorerPath
$shortcut.Arguments = $applicationsUrl
$shortcut.Description = 'Open CyberApply Applications'
$shortcut.Save()

# Assign the documented desktop-toast AppUserModelID to this dedicated shortcut.
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using System.Runtime.InteropServices.ComTypes;
[ComImport, Guid("00021401-0000-0000-C000-000000000046")] class CyberApplyShellLink { }
[StructLayout(LayoutKind.Sequential)] struct CyberApplyPropertyKey { public Guid fmtid; public uint pid; }
[StructLayout(LayoutKind.Explicit, Size=24)] struct CyberApplyPropertyValue {
 [FieldOffset(0)] public ushort type; [FieldOffset(8)] public IntPtr text;
}
[ComImport, Guid("886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface CyberApplyPropertyStore {
 [PreserveSig] int GetCount(out uint count);
 [PreserveSig] int GetAt(uint index, out CyberApplyPropertyKey key);
 [PreserveSig] int GetValue(ref CyberApplyPropertyKey key, out CyberApplyPropertyValue value);
 [PreserveSig] int SetValue(ref CyberApplyPropertyKey key, ref CyberApplyPropertyValue value);
 [PreserveSig] int Commit();
}
public static class CyberApplyToastIdentity {
 public static void Register(string path, string id) {
  object link = new CyberApplyShellLink();
  try {
   var persist = (IPersistFile)link; persist.Load(path, 2);
   var store = (CyberApplyPropertyStore)link;
   var key = new CyberApplyPropertyKey { fmtid = new Guid("9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3"), pid = 5 };
   var value = new CyberApplyPropertyValue { type = 31, text = Marshal.StringToCoTaskMemUni(id) };
   try { Marshal.ThrowExceptionForHR(store.SetValue(ref key, ref value)); Marshal.ThrowExceptionForHR(store.Commit()); persist.Save(path, true); }
   finally { Marshal.FreeCoTaskMem(value.text); }
  } finally { Marshal.FinalReleaseComObject(link); }
 }
}
'@
[CyberApplyToastIdentity]::Register($shortcutPath, $applicationId)
$identityKey = 'HKCU:\Software\Classes\AppUserModelId\' + $applicationId
New-Item -Path $identityKey -Force > $null
New-ItemProperty -Path $identityKey -Name 'DisplayName' -Value 'CyberApply' -PropertyType String -Force > $null
[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null
[Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom.XmlDocument, ContentType=WindowsRuntime] > $null
[Windows.UI.Notifications.NotificationSetting, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($applicationId)
$sent = @()
try { $setting = $notifier.get_Setting().ToString() } catch { $setting = 'SettingUnavailable' }
foreach ($item in @($payload.items)) {
 if ($item.kind -notin @('input','submit') -or $item.tag -notmatch '^[a-zA-Z0-9-]{1,16}$' -or $item.body.Length -gt 400) { throw 'Invalid notification content.' }
 if ($setting -notin @('Enabled','SettingUnavailable')) { continue }
 $title = if ($item.kind -eq 'input') { 'CyberApply - your input is needed' } else { 'CyberApply - ready to submit it yourself' }
 $document = New-Object Windows.Data.Xml.Dom.XmlDocument
 $safeTitle = [Security.SecurityElement]::Escape($title)
 $safeBody = [Security.SecurityElement]::Escape([string]$item.body)
 $safeUrl = [Security.SecurityElement]::Escape($applicationsUrl)
 $document.LoadXml("<toast activationType=`"protocol`" launch=`"$safeUrl`"><visual><binding template=`"ToastGeneric`"><text>$safeTitle</text><text>$safeBody</text></binding></visual><audio src=`"ms-winsoundevent:Notification.Default`"/></toast>")
 $toast = [Windows.UI.Notifications.ToastNotification]::new($document)
 $toast.Tag = $item.tag
 $toast.Group = 'CyberApplyApplications'
 $notifier.Show($toast)
 $sent += [string]$item.tag
}
@{sent=@($sent);setting=$setting} | ConvertTo-Json -Compress
