Option Explicit

Dim args
Set args = WScript.Arguments

Dim entryId
Dim storeId
entryId = ""
storeId = ""

ParseArgs args, entryId, storeId

If Trim(entryId) = "" Then
  Fail "Missing --entry-id."
End If

OpenOutlookMail entryId, storeId
WScript.Echo "Opened Outlook mail."

Sub ParseArgs(byVal cliArgs, ByRef targetEntryId, ByRef targetStoreId)
  Dim i
  For i = 0 To cliArgs.Count - 1
    Dim current
    current = LCase(cliArgs(i))

    Select Case current
      Case "--entry-id"
        If i + 1 >= cliArgs.Count Then
          Fail "Missing value for --entry-id."
        End If
        targetEntryId = cliArgs(i + 1)
        i = i + 1
      Case "--store-id"
        If i + 1 >= cliArgs.Count Then
          Fail "Missing value for --store-id."
        End If
        targetStoreId = cliArgs(i + 1)
        i = i + 1
      Case "--help", "-h", "/?"
        PrintUsage
        WScript.Quit 0
      Case Else
        Fail "Unknown argument: " & cliArgs(i)
    End Select
  Next
End Sub

Sub OpenOutlookMail(byVal entryIdValue, byVal storeIdValue)
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

  item.Display
  ActivateOutlookItem item
  BringOutlookToFront
End Sub

Sub ActivateOutlookItem(ByVal item)
  On Error Resume Next
  Dim inspector
  Set inspector = item.GetInspector
  inspector.Activate
  item.Activate
  On Error GoTo 0
End Sub

Sub BringOutlookToFront()
  On Error Resume Next
  WScript.Sleep 200
  Dim shell
  Set shell = CreateObject("WScript.Shell")
  shell.AppActivate "Outlook"
  On Error GoTo 0
End Sub

Sub PrintUsage()
  WScript.Echo "Usage: cscript //nologo open-outlook-mail.vbs --entry-id <entry-id> [--store-id <store-id>]"
End Sub

Sub Fail(byVal message)
  WScript.StdErr.WriteLine message
  WScript.Quit 1
End Sub
