Option Explicit

Dim shell, files, appRoot, electronPath, command
Set shell = CreateObject("WScript.Shell")
Set files = CreateObject("Scripting.FileSystemObject")

appRoot = files.GetParentFolderName(WScript.ScriptFullName)
electronPath = appRoot & "\node_modules\electron\dist\electron.exe"

If Not files.FileExists(electronPath) Then
  MsgBox "Codex Whale Widget is missing Electron. Run npm install in: " & appRoot, 16, "Codex Whale Widget"
  WScript.Quit 1
End If

command = Chr(34) & electronPath & Chr(34) & " " & Chr(34) & appRoot & Chr(34)
shell.Run command, 0, False
