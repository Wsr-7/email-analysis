Option Explicit

Dim args
Set args = WScript.Arguments

Dim entryId, storeId, mode, bodyFile
entryId = ""
storeId = ""
mode = ""
bodyFile = ""

ParseArgs args, entryId, storeId, mode, bodyFile

If Trim(entryId) = "" Then
  Fail "Missing --entry-id."
End If

If mode <> "reply" And mode <> "replyall" And mode <> "forward" Then
  Fail "Missing or unsupported --mode. Use reply, replyAll, or forward."
End If

Dim draftBody
draftBody = ""
If Trim(bodyFile) <> "" Then
  draftBody = ReadBodyFile(bodyFile)
End If

ComposeOutlookMail entryId, storeId, mode, draftBody
WScript.Echo "Opened Outlook " & mode & " window."

Sub ParseArgs(ByVal cliArgs, ByRef targetEntryId, ByRef targetStoreId, ByRef targetMode, ByRef targetBodyFile)
  Dim i
  For i = 0 To cliArgs.Count - 1
    Dim current
    current = LCase(cliArgs(i))

    Select Case current
      Case "--entry-id"
        If i + 1 >= cliArgs.Count Then Fail "Missing value for --entry-id."
        targetEntryId = cliArgs(i + 1)
        i = i + 1
      Case "--store-id"
        If i + 1 >= cliArgs.Count Then Fail "Missing value for --store-id."
        targetStoreId = cliArgs(i + 1)
        i = i + 1
      Case "--mode"
        If i + 1 >= cliArgs.Count Then Fail "Missing value for --mode."
        targetMode = LCase(cliArgs(i + 1))
        i = i + 1
      Case "--body-file"
        If i + 1 >= cliArgs.Count Then Fail "Missing value for --body-file."
        targetBodyFile = cliArgs(i + 1)
        i = i + 1
      Case "--help", "-h", "/?"
        PrintUsage
        WScript.Quit 0
      Case Else
        Fail "Unknown argument: " & cliArgs(i)
    End Select
  Next
End Sub

Function ReadBodyFile(ByVal filePath)
  On Error Resume Next
  Dim fso
  Set fso = CreateObject("Scripting.FileSystemObject")
  If Not fso.FileExists(filePath) Then
    Fail "Body file not found: " & filePath
  End If

  Dim stream, content
  Set stream = CreateObject("ADODB.Stream")
  stream.Type = 2
  stream.Charset = "utf-8"
  stream.Open
  stream.LoadFromFile filePath
  content = stream.ReadText
  stream.Close
  If Err.Number <> 0 Then
    Fail "Unable to read body file: " & Err.Description
  End If
  On Error GoTo 0
  ReadBodyFile = content
End Function

Sub ComposeOutlookMail(ByVal entryIdValue, ByVal storeIdValue, ByVal composeMode, ByVal bodyText)
  On Error Resume Next
  Dim outlook
  Set outlook = CreateObject("Outlook.Application")
  If Err.Number <> 0 Then
    Fail "Unable to create Outlook.Application. " & Err.Description
  End If
  On Error GoTo 0

  Dim ns
  Set ns = outlook.GetNamespace("MAPI")

  On Error Resume Next
  Dim item
  If Trim(storeIdValue) <> "" Then
    Set item = ns.GetItemFromID(entryIdValue, storeIdValue)
  Else
    Set item = ns.GetItemFromID(entryIdValue)
  End If
  If Err.Number <> 0 Then
    Fail "Unable to find Outlook mail by EntryID. " & Err.Description
  End If
  On Error GoTo 0

  If item Is Nothing Then
    Fail "Outlook returned no item for the provided EntryID."
  End If

  On Error Resume Next
  Dim compose
  Select Case composeMode
    Case "reply"
      Set compose = item.Reply
    Case "replyall"
      Set compose = item.ReplyAll
    Case "forward"
      Set compose = item.Forward
  End Select
  If Err.Number <> 0 Then
    Fail "Unable to create " & composeMode & " window. " & Err.Description
  End If
  On Error GoTo 0

  If compose Is Nothing Then
    Fail "Outlook returned no compose item for mode: " & composeMode
  End If

  compose.Display

  If Trim(bodyText) <> "" Then
    On Error Resume Next
    Dim safeHtml
    safeHtml = TextToHtml(bodyText)
    Dim existing
    existing = compose.HTMLBody
    Dim insertPos
    insertPos = InStr(1, existing, "<body", vbTextCompare)
    If insertPos > 0 Then
      Dim closeTag
      closeTag = InStr(insertPos, existing, ">", vbTextCompare)
      If closeTag > 0 Then
        compose.HTMLBody = Left(existing, closeTag) & safeHtml & Mid(existing, closeTag + 1)
      End If
    Else
      compose.HTMLBody = safeHtml & existing
    End If
    If Err.Number <> 0 Then
      WScript.StdErr.WriteLine "Warning: could not insert draft body. " & Err.Description
    End If
    On Error GoTo 0
  End If

  BringOutlookToFront
End Sub

Sub BringOutlookToFront()
  On Error Resume Next
  WScript.Sleep 200
  Dim shell
  Set shell = CreateObject("WScript.Shell")
  shell.AppActivate "Outlook"
  On Error GoTo 0
End Sub

Function TextToHtml(ByVal plainText)
  Dim result
  result = Replace(plainText, "&", "&amp;")
  result = Replace(result, "<", "&lt;")
  result = Replace(result, ">", "&gt;")
  result = Replace(result, """", "&quot;")
  result = Replace(result, vbCrLf, "<br>")
  result = Replace(result, vbLf, "<br>")
  result = Replace(result, vbCr, "<br>")
  TextToHtml = "<div style=""font-family:Calibri,sans-serif;font-size:11pt"">" & result & "</div><br>"
End Function

Sub PrintUsage()
  WScript.Echo "Usage: cscript //nologo compose-outlook-mail.vbs --entry-id <id> [--store-id <id>] --mode reply|replyAll|forward [--body-file <path>]"
End Sub

Sub Fail(ByVal message)
  WScript.StdErr.WriteLine message
  WScript.Quit 1
End Sub
