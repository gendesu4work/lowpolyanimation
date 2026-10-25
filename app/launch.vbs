' Opens Shorts Studio: starts the app server in the background (no console window) if it isn't running yet,
' then opens the app in its own Chrome/Edge window. The desktop shortcut points here.
Option Explicit
Dim sh, fso, root, url, node, browser, i
Set sh = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
root = fso.GetParentFolderName(fso.GetParentFolderName(WScript.ScriptFullName))
url = "http://localhost:8800"

Function Running()
  Dim http
  Running = False
  On Error Resume Next
  Set http = CreateObject("MSXML2.ServerXMLHTTP.6.0")
  http.setTimeouts 1000, 1000, 1000, 1000
  http.Open "GET", url & "/api/ping", False
  http.Send
  If Err.Number = 0 Then If http.Status = 200 Then Running = True
  On Error GoTo 0
End Function

If Not Running() Then
  node = "C:\Program Files\nodejs\node.exe"
  If Not fso.FileExists(node) Then node = "node"
  sh.CurrentDirectory = root
  ' window style 0 = hidden; output goes to data\app.log for troubleshooting
  sh.Run "cmd /c """"" & node & """ scripts\app.js --no-open > data\app.log 2>&1""", 0, False
  For i = 1 To 40
    WScript.Sleep 500
    If Running() Then Exit For
  Next
  If Not Running() Then
    MsgBox "Shorts Studio couldn't start. Details are in data\app.log in the shorts-automation folder.", vbExclamation, "Shorts Studio"
    WScript.Quit 1
  End If
End If

browser = ""
If fso.FileExists("C:\Program Files\Google\Chrome\Application\chrome.exe") Then browser = "C:\Program Files\Google\Chrome\Application\chrome.exe"
If browser = "" And fso.FileExists("C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe") Then browser = "C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe"
If browser = "" Then
  sh.Run url
Else
  sh.Run """" & browser & """ --app=" & url & " --window-size=1440,900", 1, False
End If
