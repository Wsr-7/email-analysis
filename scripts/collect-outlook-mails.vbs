Option Explicit

Dim fso
Set fso = CreateObject("Scripting.FileSystemObject")

Dim args
Set args = WScript.Arguments

Dim config
Set config = CreateObject("Scripting.Dictionary")
config.CompareMode = 1
config.Add "max-items", 50
config.Add "recent-hours", 24
config.Add "range-mode", "recentHours"
config.Add "folders", "Inbox;Sent Items"
config.Add "body-chars", 1500
config.Add "output", ""
config.Add "older-than-map", ""
config.Add "sample", False
config.Add "help", False
config.Add "list-folders", False

Dim g_currentUserSmtp, g_currentUserName, g_recipientParseFailures
g_currentUserSmtp = ""
g_currentUserName = ""
g_recipientParseFailures = 0

ParseArgs args, config

If config("help") Then
  PrintUsage
  WScript.Quit 0
End If

If config("output") = "" Then
  If CBool(config("list-folders")) Then
    config("output") = fso.BuildPath(GetScriptDirectory(), "..\data\outlook-folders.txt")
  Else
    config("output") = fso.BuildPath(GetScriptDirectory(), "..\data\mail-digest.md")
  End If
End If

EnsureParentFolder config("output")

If CBool(config("sample")) Then
  If CBool(config("list-folders")) Then
    WriteSampleFolderList config("output")
    WScript.Echo "Generated sample folder list at: " & config("output")
  Else
    WriteSampleDigest config("output"), config
    WScript.Echo "Generated sample digest at: " & config("output")
  End If
  WScript.Quit 0
End If

If CBool(config("list-folders")) Then
  CollectFolderList config("output")
  WScript.Echo "Generated folder list at: " & config("output")
Else
  CollectFromOutlook config("output"), config
  WScript.Echo "Generated digest at: " & config("output")
End If

Sub ParseArgs(byVal cliArgs, byRef target)
  Dim i
  For i = 0 To cliArgs.Count - 1
    Dim current
    current = LCase(cliArgs(i))

    Select Case current
      Case "--max-items", "--recent-hours", "--range-mode", "--folders", "--body-chars", "--output", "--older-than-map"
        If i + 1 >= cliArgs.Count Then
          Fail "Missing value for argument: " & current
        End If
        target(Mid(current, 3)) = cliArgs(i + 1)
        i = i + 1
      Case "--sample"
        target("sample") = True
      Case "--list-folders"
        target("list-folders") = True
      Case "--help", "-h", "/?"
        target("help") = True
      Case Else
        Fail "Unknown argument: " & cliArgs(i)
    End Select
  Next
End Sub

Sub CollectFolderList(byVal outputPath)
  On Error Resume Next
  Dim outlook
  Set outlook = CreateObject("Outlook.Application")
  If Err.Number <> 0 Then
    Fail "Unable to create Outlook.Application. " & Err.Description
  End If
  On Error GoTo 0

  Dim ns
  Set ns = outlook.GetNamespace("MAPI")

  Dim content
  content = "EasyMailFolderList: version=1; mode=list-folders" & vbCrLf
  Dim defaultFolderIds
  Set defaultFolderIds = CreateObject("Scripting.Dictionary")
  defaultFolderIds.CompareMode = 1
  CollectDefaultFolderIds ns, defaultFolderIds

  Dim storeCount
  On Error Resume Next
  storeCount = ns.Folders.Count
  If Err.Number <> 0 Then
    Fail "Unable to enumerate Outlook stores. " & Err.Description
  End If
  On Error GoTo 0

  Dim idx
  For idx = 1 To storeCount
    Dim root
    On Error Resume Next
    Set root = ns.Folders.Item(idx)
    If Err.Number <> 0 Then
      content = content & "FolderList: storeIndex=" & CStr(idx) & "; error=" & OneLine(Err.Description) & vbCrLf
      Err.Clear
      On Error GoTo 0
    Else
      On Error GoTo 0
      If Not root Is Nothing Then
        EnumerateFolderForList root, SafeFolderName(root), content, False, defaultFolderIds
      End If
    End If
  Next

  WriteTextFile outputPath, content
End Sub

Sub CollectDefaultFolderIds(byRef ns, byRef defaultFolderIds)
  CollectDefaultFolderId ns, 6, "Inbox", defaultFolderIds
  CollectDefaultFolderId ns, 5, "Sent Items", defaultFolderIds
  CollectDefaultFolderId ns, 16, "Drafts", defaultFolderIds
End Sub

Sub CollectDefaultFolderId(byRef ns, byVal folderType, byVal defaultName, byRef defaultFolderIds)
  Dim folder, entryId
  On Error Resume Next
  Set folder = ns.GetDefaultFolder(folderType)
  If Err.Number <> 0 Or folder Is Nothing Then
    Err.Clear
    On Error GoTo 0
    Exit Sub
  End If
  entryId = CStr(folder.EntryID)
  If Err.Number <> 0 Then
    Err.Clear
    On Error GoTo 0
    Exit Sub
  End If
  On Error GoTo 0
  entryId = Trim(entryId)
  If entryId <> "" Then
    defaultFolderIds(entryId) = defaultName
  End If
End Sub

Sub EnumerateFolderForList(byRef folder, byVal folderPath, byRef content, byVal includeFolder, byRef defaultFolderIds)
  If folderPath = "" Then
    Exit Sub
  End If

  If InStr(folderPath, ";") > 0 Then
    content = content & "FolderList: skipped=semicolon; path=" & OneLine(folderPath) & vbCrLf
    Exit Sub
  End If

  If includeFolder And IsMailFolder(folder) Then
    AppendDefaultFolderListMapping folder, folderPath, defaultFolderIds, content
    content = content & folderPath & vbCrLf
  End If

  Dim childCount
  On Error Resume Next
  childCount = folder.Folders.Count
  If Err.Number <> 0 Then
    content = content & "FolderList: path=" & OneLine(folderPath) & "; error=" & OneLine(Err.Description) & vbCrLf
    Err.Clear
    On Error GoTo 0
    Exit Sub
  End If
  On Error GoTo 0

  Dim idx
  For idx = 1 To childCount
    Dim child
    On Error Resume Next
    Set child = folder.Folders.Item(idx)
    If Err.Number <> 0 Then
      content = content & "FolderList: path=" & OneLine(folderPath) & "; childIndex=" & CStr(idx) & "; error=" & OneLine(Err.Description) & vbCrLf
      Err.Clear
      On Error GoTo 0
    Else
      On Error GoTo 0
      If Not child Is Nothing Then
        EnumerateFolderForList child, folderPath & "/" & SafeFolderName(child), content, True, defaultFolderIds
      End If
    End If
  Next
End Sub

Sub AppendDefaultFolderListMapping(byRef folder, byVal folderPath, byRef defaultFolderIds, byRef content)
  Dim entryId
  On Error Resume Next
  entryId = CStr(folder.EntryID)
  If Err.Number <> 0 Then
    Err.Clear
    On Error GoTo 0
    Exit Sub
  End If
  On Error GoTo 0
  entryId = Trim(entryId)
  If entryId <> "" And defaultFolderIds.Exists(entryId) Then
    content = content & "FolderListDefault: " & defaultFolderIds(entryId) & "=" & folderPath & vbCrLf
  End If
End Sub

Function IsMailFolder(byRef folder)
  IsMailFolder = False
  On Error Resume Next
  IsMailFolder = (CLng(folder.DefaultItemType) = 0)
  If Err.Number <> 0 Then
    Err.Clear
    IsMailFolder = False
  End If
  On Error GoTo 0
End Function

Function SafeFolderName(byRef folder)
  SafeFolderName = ""
  On Error Resume Next
  SafeFolderName = Trim(CStr(folder.Name))
  If Err.Number <> 0 Then
    Err.Clear
    SafeFolderName = ""
  End If
  On Error GoTo 0
End Function

Sub CollectFromOutlook(byVal outputPath, byRef target)
  On Error Resume Next
  Dim outlook
  Set outlook = CreateObject("Outlook.Application")
  If Err.Number <> 0 Then
    Fail "Unable to create Outlook.Application. " & Err.Description
  End If
  On Error GoTo 0

  Dim ns
  Set ns = outlook.GetNamespace("MAPI")
  ResolveCurrentUser ns

  Dim folderNames
  folderNames = Split(CStr(target("folders")), ";")

  Dim collected()
  Dim collectedCount
  collectedCount = 0
  Dim folderCount
  folderCount = 0
  Dim folderFailureCount
  folderFailureCount = 0
  Dim folderFailures
  folderFailures = ""
  Dim folderPartialCount
  folderPartialCount = 0
  Dim folderPartials
  folderPartials = ""

  Dim idx
  For idx = 0 To UBound(folderNames)
    Dim folderPath
    folderPath = Trim(folderNames(idx))
    If folderPath <> "" Then
      folderCount = folderCount + 1
      Dim folderStatus
      folderStatus = CollectFolderItems(ns, folderPath, CStr(target("range-mode")), CLng(target("max-items")), CLng(target("recent-hours")), CLng(target("body-chars")), OlderThanForFolder(target("older-than-map"), folderPath), collected, collectedCount)
      If folderStatus = "failed" Then
        folderFailureCount = folderFailureCount + 1
        folderFailures = AppendDiagList(folderFailures, folderPath)
      ElseIf folderStatus = "partial" Then
        folderPartialCount = folderPartialCount + 1
        folderPartials = AppendDiagList(folderPartials, folderPath)
      End If
    End If
  Next
  If folderCount > 0 And folderFailureCount >= folderCount Then
    Fail "All Outlook folders failed: " & folderFailures
  End If
  If folderFailureCount + folderPartialCount > 0 Then
    WScript.Echo "FolderScanSummary: failed=" & folderFailureCount & "; partial=" & folderPartialCount & "; total=" & folderCount & "; folders=" & folderFailures & "; partialFolders=" & folderPartials
  End If
  Dim scanSummary
  scanSummary = "ok"
  If folderFailureCount + folderPartialCount > 0 Then
    scanSummary = "failed=" & folderFailureCount & "; partial=" & folderPartialCount & "; folders=" & AppendDiagList(folderFailures, folderPartials)
  End If

  Dim beforeGlobalCap
  beforeGlobalCap = collectedCount
  SortMailRecords collected, collectedCount
  If IsMaxItemsMode(target("range-mode")) And collectedCount > CLng(target("max-items")) Then
    collectedCount = CLng(target("max-items"))
  End If
  WScript.Echo "DigestCap: mode=" & target("range-mode") & "; collected=" & beforeGlobalCap & "; emitted=" & collectedCount & "; maxItems=" & target("max-items")
  If g_recipientParseFailures > 0 Then
    WScript.Echo "RecipientResolution: parseFailures=" & g_recipientParseFailures & "; toMe/ccMe fell back to true for those mails"
  End If
  WriteDigest outputPath, target, collected, collectedCount, scanSummary
End Sub

Function CollectFolderItems(byRef ns, byVal folderPath, byVal rangeMode, byVal maxItems, byVal recentHours, byVal bodyChars, byVal olderThan, byRef collected, byRef collectedCount)
  CollectFolderItems = "failed"
  Dim folder
  Set folder = ResolveFolder(ns, folderPath)
  If folder Is Nothing Then
    WScript.Echo FolderScanError(folderPath, "Outlook folder not found")
    Exit Function
  End If

  Dim timeProperty
  timeProperty = FolderTimeProperty(ns, folder, folderPath)

  Dim items
  On Error Resume Next
  Set items = folder.Items
  If Err.Number <> 0 Then
    WScript.Echo FolderScanError(folderPath, "Unable to access Outlook folder items: " & Err.Description)
    Err.Clear
    On Error GoTo 0
    Exit Function
  End If
  On Error GoTo 0
  If items Is Nothing Then
    WScript.Echo FolderScanError(folderPath, "Outlook folder items collection is empty")
    Exit Function
  End If
  Dim totalItems
  totalItems = SafeItemsCount(items)

  Dim cutoffEnabled
  cutoffEnabled = IsRecentHoursMode(rangeMode)
  Dim cutoff
  If cutoffEnabled Then
    cutoff = DateAdd("h", -recentHours, Now)
  End If

  Dim restricted
  If Trim(CStr(olderThan)) <> "" Then
    WScript.Echo "RestrictFilter: folder=" & OneLine(folderPath) & "; filter=[" & timeProperty & "] < '" & FormatRestrictDate(ParseAnchorDate(olderThan)) & "'"
    On Error Resume Next
    Set restricted = items.Restrict("[" & timeProperty & "] < '" & FormatRestrictDate(ParseAnchorDate(olderThan)) & "'")
    If Err.Number <> 0 Then
      WScript.Echo FolderScanError(folderPath, "Unable to restrict Outlook folder by " & timeProperty & ": " & Err.Description)
      Err.Clear
      On Error GoTo 0
      Exit Function
    End If
    On Error GoTo 0
    Set items = restricted
  End If
  If cutoffEnabled Then
    WScript.Echo "RestrictFilter: folder=" & OneLine(folderPath) & "; filter=[" & timeProperty & "] >= '" & FormatRestrictDate(cutoff) & "'"
    On Error Resume Next
    Set restricted = items.Restrict("[" & timeProperty & "] >= '" & FormatRestrictDate(cutoff) & "'")
    If Err.Number <> 0 Then
      WScript.Echo "FolderScan: folder=" & folderPath & "; warning=recentHoursRestrictFailed; timeProperty=" & timeProperty & "; error=" & Err.Description
      Err.Clear
    ElseIf Not restricted Is Nothing Then
      Set items = restricted
    End If
    On Error GoTo 0
  End If
  Dim candidateItems
  candidateItems = SafeItemsCount(items)
  On Error Resume Next
  items.Sort "[" & timeProperty & "]", True
  If Err.Number <> 0 Then
    WScript.Echo FolderScanError(folderPath, "Unable to sort Outlook folder by " & timeProperty & ": " & Err.Description)
    Err.Clear
    On Error GoTo 0
    Exit Function
  End If
  On Error GoTo 0

  Dim scanned
  scanned = 0
  Dim addedInFolder
  addedInFolder = 0
  Dim itemErrors
  itemErrors = 0
  Dim capEnabled
  capEnabled = IsMaxItemsMode(rangeMode)

  On Error Resume Next
  Dim item
  Set item = items.GetFirst
  If Err.Number <> 0 Then
    WScript.Echo FolderScanError(folderPath, "Unable to iterate Outlook folder: " & Err.Description)
    Err.Clear
    On Error GoTo 0
    Exit Function
  End If
  On Error GoTo 0

  Do While Not item Is Nothing
    scanned = scanned + 1
    If TypeName(item) = "MailItem" Then
      Dim sortDate
      sortDate = MailSortDate(item, timeProperty)
      If IsAcceptableMailDate(sortDate) Then
        If cutoffEnabled And sortDate < cutoff Then
          Exit Do
        End If
        If (Not cutoffEnabled) Or sortDate >= cutoff Then
          Dim record
          On Error Resume Next
          Set record = BuildMailRecord(item, folderPath, timeProperty, bodyChars, collectedCount + 1)
          If Err.Number <> 0 Then
            WScript.Echo "FolderScan: folder=" & OneLine(folderPath) & "; itemError=" & OneLine(Err.Description)
            itemErrors = itemErrors + 1
            Err.Clear
            On Error GoTo 0
          Else
            On Error GoTo 0
            If Not record Is Nothing Then
              AddRecordToArray collected, collectedCount, record
              addedInFolder = addedInFolder + 1
              If capEnabled And addedInFolder >= maxItems Then
                Exit Do
              End If
            End If
          End If
        End If
      End If
    End If
    On Error Resume Next
    Set item = items.GetNext
    If Err.Number <> 0 Then
      WScript.Echo FolderScanError(folderPath, "Unable to continue Outlook folder iteration: " & Err.Description)
      Err.Clear
      On Error GoTo 0
      If addedInFolder > 0 Or itemErrors > 0 Then
        CollectFolderItems = "partial"
      End If
      Exit Function
    End If
    On Error GoTo 0
  Loop
  Dim modeParameter
  If cutoffEnabled Then
    modeParameter = "; recentHours=" & recentHours
  Else
    modeParameter = "; maxItems=" & maxItems
  End If
  WScript.Echo "FolderScan: folder=" & folderPath & "; mode=" & rangeMode & "; timeProperty=" & timeProperty & "; totalItems=" & totalItems & "; candidateItems=" & candidateItems & "; scanned=" & scanned & "; added=" & addedInFolder & "; itemErrors=" & itemErrors & modeParameter & "; olderThan=" & ValueOrDash(olderThan)
  If itemErrors > 0 Then
    CollectFolderItems = "partial"
  Else
    CollectFolderItems = "ok"
  End If
End Function

Function FolderScanError(byVal folderPath, byVal message)
  FolderScanError = "FolderScan: folder=" & OneLine(folderPath) & "; error=" & OneLine(message)
End Function

Function AppendDiagList(byVal current, byVal value)
  If Trim(CStr(current)) = "" Then
    AppendDiagList = OneLine(value)
  Else
    AppendDiagList = current & "," & OneLine(value)
  End If
End Function

Function OneLine(byVal value)
  Dim text
  text = Replace(CStr(value), vbCr, " ")
  text = Replace(text, vbLf, " ")
  text = Replace(text, ";", ",")
  OneLine = Trim(text)
End Function

Function IsRecentHoursMode(byVal rangeMode)
  IsRecentHoursMode = (LCase(Trim(CStr(rangeMode))) = "recenthours")
End Function

Function IsMaxItemsMode(byVal rangeMode)
  IsMaxItemsMode = Not IsRecentHoursMode(rangeMode)
End Function

Function FolderTimeProperty(byRef ns, byRef folder, byVal folderPath)
  If IsSentFolder(ns, folder) Or LCase(Trim(CStr(folderPath))) = "sent items" Then
    FolderTimeProperty = "SentOn"
  Else
    FolderTimeProperty = "ReceivedTime"
  End If
End Function

Function IsSentFolder(byRef ns, byRef folder)
  IsSentFolder = False
  On Error Resume Next
  Dim sentFolder
  Set sentFolder = ns.GetDefaultFolder(5)
  If Err.Number <> 0 Or sentFolder Is Nothing Or folder Is Nothing Then
    Err.Clear
    On Error GoTo 0
    Exit Function
  End If

  Dim sentEntryId
  sentEntryId = SafeString(sentFolder.EntryID)
  If sentEntryId = "" Then
    On Error GoTo 0
    Exit Function
  End If
  Dim current
  Set current = folder
  Dim depth
  For depth = 0 To 10
    If current Is Nothing Then
      Exit For
    End If
    Dim currentEntryId
    currentEntryId = SafeString(current.EntryID)
    If Err.Number <> 0 Then
      Err.Clear
      Exit For
    End If
    If currentEntryId = sentEntryId Then
      IsSentFolder = True
      Exit For
    End If
    Set current = current.Parent
    If Err.Number <> 0 Then
      Err.Clear
      Exit For
    End If
  Next
  On Error GoTo 0
End Function

Function IsAcceptableMailDate(byVal value)
  Dim yearPart
  yearPart = Year(value)
  IsAcceptableMailDate = (yearPart >= 1990 And yearPart <= 2100)
End Function

Function SafeItemsCount(byRef items)
  On Error Resume Next
  SafeItemsCount = CLng(items.Count)
  If Err.Number <> 0 Then
    Err.Clear
    SafeItemsCount = -1
  End If
  On Error GoTo 0
End Function

Function ValueOrDash(byVal value)
  If Trim(CStr(value)) = "" Then
    ValueOrDash = "-"
  Else
    ValueOrDash = CStr(value)
  End If
End Function

Function OlderThanForFolder(byVal mapText, byVal folderPath)
  OlderThanForFolder = ""
  If Trim(CStr(mapText)) = "" Then
    Exit Function
  End If

  Dim pairs
  pairs = Split(CStr(mapText), ";")
  Dim targetKey
  targetKey = LCase(Trim(folderPath))

  Dim i
  For i = 0 To UBound(pairs)
    Dim pair
    pair = pairs(i)
    Dim pos
    pos = InStr(pair, "=")
    If pos > 0 Then
      Dim key
      key = LCase(Trim(Left(pair, pos - 1)))
      If key = targetKey Then
        OlderThanForFolder = Trim(Mid(pair, pos + 1))
        Exit Function
      End If
    End If
  Next
End Function

Function FormatRestrictDate(byVal dateValue)
  Dim hourPart
  Dim suffix
  hourPart = Hour(dateValue)
  suffix = "AM"
  If hourPart >= 12 Then
    suffix = "PM"
  End If
  If hourPart = 0 Then
    hourPart = 12
  ElseIf hourPart > 12 Then
    hourPart = hourPart - 12
  End If
  FormatRestrictDate = Month(dateValue) & "/" & Day(dateValue) & "/" & Year(dateValue) & " " & hourPart & ":" & Right("0" & Minute(dateValue), 2) & " " & suffix
End Function

Function ParseAnchorDate(byVal value)
  Dim text
  text = Replace(Trim(CStr(value)), "T", " ")
  Dim parts
  parts = Split(text, " ")
  If UBound(parts) < 1 Then
    Fail "Invalid older-than date: " & value
  End If

  Dim dateParts
  Dim timeParts
  dateParts = Split(parts(0), "-")
  timeParts = Split(parts(1), ":")
  If UBound(dateParts) < 2 Or UBound(timeParts) < 1 Then
    Fail "Invalid older-than date: " & value
  End If

  Dim secondPart
  secondPart = 0
  If UBound(timeParts) >= 2 Then
    secondPart = CLng(timeParts(2))
  End If
  ParseAnchorDate = DateSerial(CLng(dateParts(0)), CLng(dateParts(1)), CLng(dateParts(2))) + TimeSerial(CLng(timeParts(0)), CLng(timeParts(1)), secondPart)
End Function

Function ResolveFolder(byRef ns, byVal folderPath)
  Dim normalized
  normalized = Replace(folderPath, "\", "/")
  Dim parts
  parts = Split(normalized, "/")

  Dim root
  root = Trim(parts(0))

  Dim folder
  On Error Resume Next
  If LCase(root) = "inbox" Then
    Set folder = ns.GetDefaultFolder(6)
  ElseIf LCase(root) = "sent items" Then
    Set folder = ns.GetDefaultFolder(5)
  ElseIf LCase(root) = "drafts" Then
    Set folder = ns.GetDefaultFolder(16)
  Else
    Set folder = ns.Folders(root)
  End If
  If Err.Number <> 0 Then
    Err.Clear
    Set ResolveFolder = Nothing
    On Error GoTo 0
    Exit Function
  End If
  On Error GoTo 0

  If folder Is Nothing Then
    Set ResolveFolder = Nothing
    Exit Function
  End If

  Dim i
  For i = 1 To UBound(parts)
    Dim childName
    childName = Trim(parts(i))
    If childName <> "" Then
      On Error Resume Next
      Set folder = folder.Folders(childName)
      If Err.Number <> 0 Then
        Err.Clear
        Set ResolveFolder = Nothing
        Exit Function
      End If
      On Error GoTo 0
    End If
  Next

  Set ResolveFolder = folder
End Function

Function BuildMailRecord(byRef mail, byVal folderPath, byVal timeProperty, byVal bodyChars, byVal recordIndex)
  Dim record
  Set record = CreateObject("Scripting.Dictionary")
  record.CompareMode = 1
  record.Add "mailId", "mail-" & Right("000" & CStr(recordIndex), 3)
  record.Add "internetMessageId", SafeInternetMessageId(mail)
  record.Add "entryId", SafeString(mail.EntryID)
  record.Add "storeId", SafeStoreId(mail)
  record.Add "conversationId", SafeConversationId(mail)
  record.Add "conversationIndex", SafeConversationIndex(mail)
  record.Add "subject", SafeString(mail.Subject)
  Dim senderName, senderEmail
  senderName = SafeString(mail.SenderName)
  senderEmail = SafeSenderEmail(mail)
  If senderName = "" Then
    senderName = senderEmail
  End If
  record.Add "senderName", senderName
  record.Add "senderEmail", senderEmail
  record.Add "receivedTime", FormatDateValue(MailSortDate(mail, timeProperty))
  record.Add "sentTime", SafeDateValue(mail.SentOn)
  record.Add "sortKey", Replace(FormatDateValue(MailSortDate(mail, timeProperty)), " ", "T")
  record.Add "folderPath", folderPath
  record.Add "unread", LCase(CStr(CBool(mail.UnRead)))
  record.Add "importance", ImportanceLabel(mail.Importance)
  record.Add "toMe", LCase(CStr(IsDirectRecipient(mail)))
  record.Add "ccMe", LCase(CStr(IsCcRecipient(mail)))
  record.Add "to", SafeTo(mail)
  record.Add "cc", SafeCc(mail)
  record.Add "attachmentCount", SafeAttachmentCount(mail)
  record.Add "attachmentNames", SafeAttachmentNames(mail)
  record.Add "bodyExcerpt", TruncateText(SafeString(mail.Body), bodyChars)
  Set BuildMailRecord = record
End Function

Function MailSortDate(byRef mail, byVal timeProperty)
  On Error Resume Next
  If timeProperty = "SentOn" Then
    MailSortDate = mail.SentOn
  Else
    MailSortDate = mail.ReceivedTime
  End If
  If Err.Number <> 0 Then
    Err.Clear
    MailSortDate = mail.ReceivedTime
  End If
  On Error GoTo 0
End Function

Function SafeInternetMessageId(byRef mail)
  On Error Resume Next
  Dim accessor
  Set accessor = mail.PropertyAccessor
  SafeInternetMessageId = SafeString(accessor.GetProperty("http://schemas.microsoft.com/mapi/proptag/0x1035001E"))
  If Err.Number <> 0 Then
    Err.Clear
    SafeInternetMessageId = ""
  End If
  On Error GoTo 0
End Function

Function SafeStoreId(byRef mail)
  On Error Resume Next
  Dim parentFolder
  Set parentFolder = mail.Parent
  SafeStoreId = SafeString(parentFolder.StoreID)
  If Err.Number <> 0 Then
    Err.Clear
    SafeStoreId = ""
  End If
  On Error GoTo 0
End Function

Function SafeSenderEmail(byRef mail)
  Dim address
  On Error Resume Next
  address = SafeString(mail.SenderEmailAddress)
  If Err.Number <> 0 Then
    Err.Clear
  End If
  Dim addressEntry
  Set addressEntry = mail.Sender
  If Err.Number = 0 And Not addressEntry Is Nothing Then
    address = ResolveExchangeSmtpAddress(addressEntry, address)
  End If
  Err.Clear
  SafeSenderEmail = address
  On Error GoTo 0
End Function

Function ResolveExchangeSmtpAddress(byRef addressEntry, byVal address)
  ResolveExchangeSmtpAddress = address
  If LCase(Left(Trim(CStr(address)), 3)) <> "/o=" Then
    Exit Function
  End If

  On Error Resume Next
  Dim exchangeUser
  Set exchangeUser = addressEntry.GetExchangeUser()
  If Err.Number = 0 And Not exchangeUser Is Nothing Then
    Dim smtp
    smtp = SafeString(exchangeUser.PrimarySmtpAddress)
    If smtp <> "" Then
      ResolveExchangeSmtpAddress = smtp
    End If
  End If
  Err.Clear
  On Error GoTo 0
End Function

Function SafeConversationId(byRef mail)
  On Error Resume Next
  SafeConversationId = SafeString(mail.ConversationID)
  If Err.Number <> 0 Then
    Err.Clear
    SafeConversationId = ""
  End If
  On Error GoTo 0
End Function

Function SafeConversationIndex(byRef mail)
  On Error Resume Next
  SafeConversationIndex = SafeString(mail.ConversationIndex)
  If Err.Number <> 0 Then
    Err.Clear
    SafeConversationIndex = ""
  End If
  On Error GoTo 0
End Function

Function SafeDateValue(byVal value)
  On Error Resume Next
  SafeDateValue = FormatDateValue(value)
  If Err.Number <> 0 Then
    Err.Clear
    SafeDateValue = ""
  End If
  On Error GoTo 0
End Function

Function SafeTo(byRef mail)
  SafeTo = SafeRecipientsByType(mail, 1) ' olTo
End Function

Function SafeCc(byRef mail)
  SafeCc = SafeRecipientsByType(mail, 2) ' olCC
End Function

Function SafeRecipientsByType(byRef mail, byVal recipientType)
  SafeRecipientsByType = ""
  On Error Resume Next
  Dim recipients
  Set recipients = mail.Recipients
  If Err.Number <> 0 Or recipients Is Nothing Then
    Err.Clear
    SafeRecipientsByType = SafeRecipientFallback(mail, recipientType)
    On Error GoTo 0
    Exit Function
  End If

  Dim values
  values = ""
  Dim i
  For i = 1 To recipients.Count
    Dim recipient
    Set recipient = Nothing
    Err.Clear
    Set recipient = recipients.Item(i)
    If Err.Number = 0 And Not recipient Is Nothing Then
      Dim recipientTypeValue
      recipientTypeValue = recipient.Type
      If Err.Number = 0 And recipientTypeValue = recipientType Then
        Dim address
        address = SafeString(recipient.Address)
        Dim addressEntry
        Set addressEntry = Nothing
        Err.Clear
        Set addressEntry = recipient.AddressEntry
        If Err.Number = 0 And Not addressEntry Is Nothing Then
          address = ResolveExchangeSmtpAddress(addressEntry, address)
        End If
        Err.Clear
        values = AppendRecipientAddress(values, SafeString(recipient.Name), address)
      End If
    End If
    Err.Clear
  Next
  If values = "" Then
    values = SafeRecipientFallback(mail, recipientType)
  End If
  SafeRecipientsByType = values
  On Error GoTo 0
End Function

Function SafeRecipientFallback(byRef mail, byVal recipientType)
  SafeRecipientFallback = ""
  On Error Resume Next
  If recipientType = 1 Then
    SafeRecipientFallback = SafeString(mail.To)
  ElseIf recipientType = 2 Then
    SafeRecipientFallback = SafeString(mail.CC)
  End If
  Err.Clear
  On Error GoTo 0
End Function

Function AppendRecipientAddress(byVal current, byVal displayName, byVal address)
  Dim formatted
  formatted = FormatRecipientAddress(displayName, address)
  If formatted = "" Then
    AppendRecipientAddress = current
  ElseIf current = "" Then
    AppendRecipientAddress = formatted
  Else
    AppendRecipientAddress = current & "; " & formatted
  End If
End Function

Function FormatRecipientAddress(byVal displayName, byVal address)
  displayName = Trim(CStr(displayName))
  address = Trim(CStr(address))
  If address = "" Then
    FormatRecipientAddress = displayName
  Else
    If displayName = "" Then
      displayName = address
    End If
    FormatRecipientAddress = displayName & " <" & address & ">"
  End If
End Function

Function SafeAttachmentCount(byRef mail)
  On Error Resume Next
  SafeAttachmentCount = CLng(mail.Attachments.Count)
  If Err.Number <> 0 Then
    Err.Clear
    SafeAttachmentCount = 0
  End If
  On Error GoTo 0
End Function

Function SafeAttachmentNames(byRef mail)
  On Error Resume Next
  Dim count
  count = CLng(mail.Attachments.Count)
  If Err.Number <> 0 Or count <= 0 Then
    Err.Clear
    SafeAttachmentNames = ""
    On Error GoTo 0
    Exit Function
  End If

  Dim names()
  ReDim names(count - 1)
  Dim i
  For i = 1 To count
    names(i - 1) = SafeString(mail.Attachments.Item(i).FileName)
    If Err.Number <> 0 Then
      Err.Clear
      names(i - 1) = ""
    End If
  Next
  SafeAttachmentNames = Join(names, "; ")
  On Error GoTo 0
End Function

Function IsDirectRecipient(byRef mail)
  IsDirectRecipient = IsRecipientTypeMatch(mail, 1) ' olTo
End Function

Function IsCcRecipient(byRef mail)
  IsCcRecipient = IsRecipientTypeMatch(mail, 2) ' olCC
End Function

Sub ResolveCurrentUser(byRef ns)
  On Error Resume Next
  Dim currentUser
  Set currentUser = ns.CurrentUser
  Dim gotUser
  gotUser = (Err.Number = 0) And Not (currentUser Is Nothing)
  Err.Clear
  On Error GoTo 0

  If Not gotUser Then
    WScript.Echo "CurrentUser: resolved=false; reason=ns.CurrentUser unavailable; toMe/ccMe will fallback to true"
    Exit Sub
  End If

  On Error Resume Next
  g_currentUserName = SafeString(currentUser.Name)
  Err.Clear
  On Error GoTo 0

  On Error Resume Next
  Dim addressEntry
  Set addressEntry = currentUser.AddressEntry
  If Err.Number = 0 And Not addressEntry Is Nothing Then
    Dim exchUser
    Set exchUser = addressEntry.GetExchangeUser()
    If Err.Number = 0 And Not exchUser Is Nothing Then
      g_currentUserSmtp = LCase(SafeString(exchUser.PrimarySmtpAddress))
    End If
    Err.Clear
    If g_currentUserSmtp = "" Then
      g_currentUserSmtp = LCase(SafeString(addressEntry.Address))
      Err.Clear
    End If
  End If
  On Error GoTo 0

  If g_currentUserSmtp = "" And g_currentUserName = "" Then
    WScript.Echo "CurrentUser: resolved=false; reason=smtp and name both empty; toMe/ccMe will fallback to true"
  Else
    WScript.Echo "CurrentUser: resolved=true; smtp=" & ValueOrDash(g_currentUserSmtp) & "; name=" & ValueOrDash(g_currentUserName)
  End If
End Sub

Function IsRecipientTypeMatch(byRef mail, byVal recipientType)
  ' 身份未解析成功：兜底维持 true，与恒真现状语义一致，宁可误报不漏报
  If g_currentUserSmtp = "" And g_currentUserName = "" Then
    IsRecipientTypeMatch = True
    Exit Function
  End If

  On Error Resume Next
  Dim recipients
  Set recipients = mail.Recipients
  Dim recipientsOk
  recipientsOk = (Err.Number = 0) And Not (recipients Is Nothing)
  Err.Clear
  On Error GoTo 0

  If Not recipientsOk Then
    g_recipientParseFailures = g_recipientParseFailures + 1
    IsRecipientTypeMatch = True
    Exit Function
  End If

  Dim matched
  matched = False

  Dim i
  For i = 1 To recipients.Count
    On Error Resume Next
    Dim recipient
    Set recipient = recipients.Item(i)
    Dim recipientTypeValue
    recipientTypeValue = recipient.Type
    Dim itemOk
    itemOk = (Err.Number = 0)
    Err.Clear
    On Error GoTo 0

    If itemOk Then
      If recipientTypeValue = recipientType Then
        If IsCurrentUserRecipient(recipient) Then
          matched = True
        End If
      End If
    End If
  Next

  IsRecipientTypeMatch = matched
End Function

Function IsCurrentUserRecipient(byRef recipient)
  IsCurrentUserRecipient = False

  Dim recipientSmtp
  recipientSmtp = ""

  On Error Resume Next
  Dim addressEntry
  Set addressEntry = recipient.AddressEntry
  If Err.Number = 0 And Not addressEntry Is Nothing Then
    Dim exchUser
    Set exchUser = addressEntry.GetExchangeUser()
    If Err.Number = 0 And Not exchUser Is Nothing Then
      recipientSmtp = LCase(SafeString(exchUser.PrimarySmtpAddress))
    End If
    Err.Clear
    If recipientSmtp = "" Then
      recipientSmtp = LCase(SafeString(addressEntry.Address))
      Err.Clear
    End If
  End If
  On Error GoTo 0

  If recipientSmtp <> "" And g_currentUserSmtp <> "" Then
    IsCurrentUserRecipient = (recipientSmtp = g_currentUserSmtp)
    If IsCurrentUserRecipient Then Exit Function
  End If

  Dim recipientName
  recipientName = ""
  On Error Resume Next
  recipientName = LCase(SafeString(recipient.Name))
  Err.Clear
  On Error GoTo 0

  If recipientName <> "" And g_currentUserName <> "" Then
    IsCurrentUserRecipient = (recipientName = LCase(g_currentUserName))
  End If
End Function

Function ImportanceLabel(byVal value)
  Select Case CLng(value)
    Case 2
      ImportanceLabel = "high"
    Case 0
      ImportanceLabel = "low"
    Case Else
      ImportanceLabel = "normal"
  End Select
End Function

Function TruncateText(byVal text, byVal maxChars)
  If maxChars > 0 And Len(text) > maxChars * 4 Then
    text = Left(text, maxChars * 4)
  End If
  Dim cleaned
  cleaned = NormalizeWhitespace(text)
  If Len(cleaned) <= maxChars Then
    TruncateText = cleaned
  Else
    TruncateText = Left(cleaned, maxChars) & "..."
  End If
End Function

Function NormalizeWhitespace(byVal text)
  Dim result
  result = Replace(text, vbCrLf, vbLf)
  result = Replace(result, vbCr, vbLf)
  result = Replace(result, vbTab, " ")
  Do While InStr(result, vbLf & vbLf & vbLf) > 0
    result = Replace(result, vbLf & vbLf & vbLf, vbLf & vbLf)
  Loop
  NormalizeWhitespace = Trim(result)
End Function

Function FormatDateValue(byVal dateValue)
  Dim yearPart, monthPart, dayPart, hourPart, minutePart, secondPart
  yearPart = Year(dateValue)
  monthPart = Right("0" & Month(dateValue), 2)
  dayPart = Right("0" & Day(dateValue), 2)
  hourPart = Right("0" & Hour(dateValue), 2)
  minutePart = Right("0" & Minute(dateValue), 2)
  secondPart = Right("0" & Second(dateValue), 2)
  FormatDateValue = yearPart & "-" & monthPart & "-" & dayPart & " " & hourPart & ":" & minutePart & ":" & secondPart
End Function

Sub SortMailRecords(byRef records, byVal recordCount)
  Dim i
  For i = 0 To recordCount - 2
    Dim j
    For j = i + 1 To recordCount - 1
      If records(i)("sortKey") < records(j)("sortKey") Then
        Dim temp
        Set temp = records(i)
        Set records(i) = records(j)
        Set records(j) = temp
      End If
    Next
  Next
End Sub

Sub WriteDigest(byVal outputPath, byRef target, byRef records, byVal recordCount, byVal scanSummary)
  Dim content
  content = "# Outlook Mail Digest" & vbCrLf & vbCrLf
  content = content & "GeneratedAt: " & FormatDateValue(Now) & vbCrLf
  content = content & "RangeMode: " & target("range-mode") & vbCrLf
  If IsRecentHoursMode(target("range-mode")) Then
    content = content & "RecentHours: " & target("recent-hours") & vbCrLf
  Else
    content = content & "MaxItems: " & target("max-items") & vbCrLf
  End If
  content = content & "Folders:" & vbCrLf

  Dim folderNames
  folderNames = Split(CStr(target("folders")), ";")
  Dim i
  For i = 0 To UBound(folderNames)
    content = content & "- " & Trim(folderNames(i)) & vbCrLf
  Next
  content = content & "ScanSummary: " & scanSummary & vbCrLf

  content = content & vbCrLf & "---" & vbCrLf

  Dim index
  For index = 0 To recordCount - 1
    Dim record
    Set record = records(index)
    content = content & vbCrLf
    content = content & "## Mail: " & record("mailId") & vbCrLf & vbCrLf
    content = content & "InternetMessageId: " & EscapeMarkdownInline(record("internetMessageId")) & vbCrLf
    content = content & "EntryId: " & EscapeMarkdownInline(record("entryId")) & vbCrLf
    content = content & "StoreId: " & EscapeMarkdownInline(record("storeId")) & vbCrLf
    content = content & "ConversationId: " & EscapeMarkdownInline(record("conversationId")) & vbCrLf
    content = content & "ConversationIndex: " & EscapeMarkdownInline(record("conversationIndex")) & vbCrLf
    content = content & "Subject: " & EscapeMarkdownInline(record("subject")) & vbCrLf
    content = content & "From: " & EscapeMarkdownInline(record("senderName")) & " <" & EscapeMarkdownInline(record("senderEmail")) & ">" & vbCrLf
    content = content & "ReceivedTime: " & record("receivedTime") & vbCrLf
    content = content & "SentTime: " & record("sentTime") & vbCrLf
    content = content & "Folder: " & EscapeMarkdownInline(record("folderPath")) & vbCrLf
    content = content & "Unread: " & record("unread") & vbCrLf
    content = content & "Importance: " & record("importance") & vbCrLf
    content = content & "ToMe: " & record("toMe") & vbCrLf
    content = content & "CcMe: " & record("ccMe") & vbCrLf
    content = content & "To: " & EscapeMarkdownInline(record("to")) & vbCrLf
    content = content & "Cc: " & EscapeMarkdownInline(record("cc")) & vbCrLf
    content = content & "AttachmentCount: " & CStr(record("attachmentCount")) & vbCrLf
    content = content & "AttachmentNames: " & EscapeMarkdownInline(record("attachmentNames")) & vbCrLf & vbCrLf
    content = content & "BodyExcerpt:" & vbCrLf
    content = content & EscapeMarkdownBlock(record("bodyExcerpt")) & vbCrLf & vbCrLf
    content = content & "---" & vbCrLf
  Next

  WriteTextFile outputPath, content
End Sub

Sub WriteSampleDigest(byVal outputPath, byRef target)
  Dim records()
  Dim recordCount
  recordCount = 0
  Dim record

  Set record = BuildSampleRecord(1, "Approve release decision by 16:00 today", "Maya Chen", "maya.chen@example.com", "Inbox/Release", "high", True, False, "The launch window closes today. Please approve or decline the release decision before 16:00.")
  record("conversationId") = "sample-thread-release"
  record("conversationIndex") = "0001"
  record("attachmentCount") = 1
  record("attachmentNames") = "release-checklist.pdf"
  AddRecordToArray records, recordCount, record

  Set record = BuildSampleRecord(2, ChrW(&H98CE) & ChrW(&H9669) & ChrW(&H63D0) & ChrW(&H9192) & ChrW(&HFF1A) & ChrW(&H751F) & ChrW(&H4EA7) & ChrW(&H8BC1) & ChrW(&H4E66) & ChrW(&H5C06) & ChrW(&H5728) & ChrW(&H4ECA) & ChrW(&H5929) & ChrW(&H5230) & ChrW(&H671F), "Security Operations", "security@example.com", "Inbox/Operations", "high", True, False, "The production certificate expires today. Renew it before customer traffic is affected.")
  record("attachmentCount") = 1
  record("attachmentNames") = "certificate-renewal-runbook.pdf"
  AddRecordToArray records, recordCount, record

  Set record = BuildSampleRecord(3, "Project Atlas launch decision", "Elena Park, CEO", "elena.park@example.com", "Inbox/Leadership", "high", True, False, "Please share the final recommendation for Project Atlas. I need your decision for the executive review.")
  record("conversationId") = "sample-thread-release"
  record("conversationIndex") = "0002"
  AddRecordToArray records, recordCount, record

  Set record = BuildSampleRecord(4, "Re: Project Atlas launch decision", "Daniel Wu", "daniel.wu@example.com", "Inbox/Leadership", "high", True, True, ChrW(&H8BF7) & ChrW(&H5728) & ChrW(&H4ECA) & ChrW(&H5929) & ChrW(&H5341) & ChrW(&H4E03) & ChrW(&H70B9) & ChrW(&H524D) & ChrW(&H786E) & ChrW(&H8BA4) & ChrW(&H9879) & ChrW(&H76EE) & ChrW(&H53D1) & ChrW(&H5E03) & ChrW(&H51B3) & ChrW(&H5B9A) & ChrW(&H3002) & "The regional team is waiting for your response.")
  record("conversationId") = "sample-thread-release"
  record("conversationIndex") = "0003"
  AddRecordToArray records, recordCount, record

  Set record = BuildSampleRecord(5, "Re: Project Atlas launch decision", "Maya Chen", "maya.chen@example.com", "Inbox/Leadership", "normal", False, False, "If we defer the launch, please confirm the owner for the customer communication plan.")
  record("conversationId") = "sample-thread-release"
  record("conversationIndex") = "0004"
  AddRecordToArray records, recordCount, record

  Set record = BuildSampleRecord(6, ChrW(&H7B49) & ChrW(&H5F85) & ChrW(&H60A8) & ChrW(&H786E) & ChrW(&H8BA4) & ChrW(&H4F9B) & ChrW(&H5E94) & ChrW(&H5546) & ChrW(&H62A5) & ChrW(&H4EF7), ChrW(&H91C7) & ChrW(&H8D2D) & ChrW(&H56E2) & ChrW(&H961F), "procurement@example.com", "Inbox/Procurement", "normal", True, False, "Supplier A can hold the quoted price until Friday. Please confirm whether we should proceed.")
  record("attachmentCount") = 1
  record("attachmentNames") = "supplier-quote.xlsx"
  AddRecordToArray records, recordCount, record

  Set record = BuildSampleRecord(7, "Weekly platform maintenance", "Platform Notifications", "no-reply@example.com", "Inbox/Notice", "normal", False, False, "Scheduled maintenance is planned for Sunday 02:00-03:00 UTC. No action is required unless your team has a conflict.")
  AddRecordToArray records, recordCount, record

  Set record = BuildSampleRecord(8, ChrW(&H5B63) & ChrW(&H5EA6) & ChrW(&H5E73) & ChrW(&H53F0) & ChrW(&H7EF4) & ChrW(&H62A4) & ChrW(&H901A) & ChrW(&H77E5), ChrW(&H5E73) & ChrW(&H53F0) & ChrW(&H901A) & ChrW(&H77E5), "platform-notify@example.com", "Inbox/Notice", "normal", False, True, ChrW(&H672C) & ChrW(&H5468) & ChrW(&H672B) & ChrW(&H5C06) & ChrW(&H8FDB) & ChrW(&H884C) & ChrW(&H4F8B) & ChrW(&H884C) & ChrW(&H7EF4) & ChrW(&H62A4) & ChrW(&HFF0C) & ChrW(&H5982) & ChrW(&H6709) & ChrW(&H51B2) & ChrW(&H7A81) & ChrW(&H8BF7) & ChrW(&H8054) & ChrW(&H7CFB) & ChrW(&H5E73) & ChrW(&H53F0) & ChrW(&H56E2) & ChrW(&H961F) & ChrW(&H3002))
  AddRecordToArray records, recordCount, record

  Set record = BuildSampleRecord(9, "FYI: Workspace beta invitation", "Product Research", "research@example.com", "Inbox/Research", "normal", False, False, "You may want to review the beta workspace proposal. It is unclear whether a response is needed this week.")
  AddRecordToArray records, recordCount, record

  Set record = BuildSampleRecord(10, "HIGHLY RESTRICTED: acquisition diligence", "Legal Counsel", "legal@example.com", "Inbox/Legal", "high", True, False, "Secret board materials for the acquisition diligence review. Do not forward. Please review the attached documents before the confidential meeting.")
  record("attachmentCount") = 2
  record("attachmentNames") = "diligence-summary.pdf; board-notes.docx"
  AddRecordToArray records, recordCount, record

  WriteDigest outputPath, target, records, recordCount, "ok"
End Sub

Sub WriteSampleFolderList(byVal outputPath)
  Dim content
  content = "EasyMailFolderList: version=1; mode=list-folders; sample=true" & vbCrLf
  content = content & "FolderListDefault: Inbox=Inbox" & vbCrLf
  content = content & "FolderListDefault: Sent Items=Sent Items" & vbCrLf
  content = content & "FolderListDefault: Drafts=Drafts" & vbCrLf
  content = content & "Inbox" & vbCrLf
  content = content & "Sent Items" & vbCrLf
  content = content & "Mailbox Name/Project Alpha" & vbCrLf
  content = content & ChrW(&H793A) & ChrW(&H4F8B) & ChrW(&H90AE) & ChrW(&H7BB1) & "/" & ChrW(&H6536) & ChrW(&H4EF6) & ChrW(&H7BB1) & vbCrLf
  content = content & "FolderList: skipped=semicolon; path=Mailbox Name/Bad;Folder" & vbCrLf
  WriteTextFile outputPath, content
End Sub

Function BuildSampleRecord(byVal recordIndex, byVal subject, byVal senderName, byVal senderEmail, byVal folderPath, byVal importance, byVal unread, byVal ccMe, byVal bodyExcerpt)
  Dim record
  Set record = CreateObject("Scripting.Dictionary")
  record.CompareMode = 1
  record.Add "mailId", "mail-" & Right("000" & CStr(recordIndex), 3)
  record.Add "internetMessageId", "<sample-" & CStr(recordIndex) & "@easy-mail.local>"
  record.Add "entryId", "sample-entry-" & CStr(recordIndex)
  record.Add "storeId", "sample-store"
  record.Add "conversationId", "sample-thread-" & CStr(recordIndex)
  record.Add "conversationIndex", "000" & CStr(recordIndex)
  record.Add "subject", subject
  record.Add "senderName", senderName
  record.Add "senderEmail", senderEmail
  record.Add "receivedTime", FormatDateValue(DateAdd("n", -recordIndex * 15, Now))
  record.Add "sentTime", FormatDateValue(DateAdd("n", -recordIndex * 15 - 2, Now))
  record.Add "folderPath", folderPath
  record.Add "unread", LCase(CStr(unread))
  record.Add "importance", importance
  record.Add "toMe", "true"
  record.Add "ccMe", LCase(CStr(ccMe))
  record.Add "to", "Me <me@example.com>"
  record.Add "cc", ""
  record.Add "attachmentCount", 0
  record.Add "attachmentNames", ""
  record.Add "bodyExcerpt", bodyExcerpt
  Set BuildSampleRecord = record
End Function

Sub WriteTextFile(byVal path, byVal content)
  Dim stream
  Set stream = CreateObject("ADODB.Stream")
  stream.Type = 2
  stream.Mode = 3
  stream.Charset = "utf-8"
  stream.Open
  stream.WriteText content
  stream.SaveToFile path, 2
  stream.Close
End Sub

Sub AddRecordToArray(byRef records, byRef recordCount, byRef record)
  If recordCount = 0 Then
    ReDim records(0)
  Else
    ReDim Preserve records(recordCount)
  End If
  Set records(recordCount) = record
  recordCount = recordCount + 1
End Sub

Function EscapeMarkdownInline(byVal text)
  Dim value
  value = SafeString(text)
  value = Replace(value, "`", "'")
  EscapeMarkdownInline = value
End Function

Function EscapeMarkdownBlock(byVal text)
  Dim value
  value = SafeString(text)
  value = Replace(value, vbCrLf, vbLf)
  value = Replace(value, vbCr, vbLf)
  EscapeMarkdownBlock = value
End Function

Function SafeString(byVal value)
  If IsNull(value) Then
    SafeString = ""
  Else
    SafeString = Trim(CStr(value))
  End If
End Function

Sub EnsureParentFolder(byVal filePath)
  Dim parent
  parent = fso.GetParentFolderName(filePath)
  If parent <> "" And Not fso.FolderExists(parent) Then
    CreateFolderRecursive parent
  End If
End Sub

Sub CreateFolderRecursive(byVal folderPath)
  If folderPath = "" Then
    Exit Sub
  End If
  If fso.FolderExists(folderPath) Then
    Exit Sub
  End If
  Dim parent
  parent = fso.GetParentFolderName(folderPath)
  If parent <> "" And Not fso.FolderExists(parent) Then
    CreateFolderRecursive parent
  End If
  fso.CreateFolder folderPath
End Sub

Function GetScriptDirectory()
  GetScriptDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
End Function

Sub PrintUsage()
  WScript.Echo "Usage:"
  WScript.Echo "  cscript //nologo collect-outlook-mails.vbs [options]"
  WScript.Echo ""
  WScript.Echo "Options:"
  WScript.Echo "  --range-mode <mode>  recentHours or maxItems."
  WScript.Echo "  --max-items <n>      Maximum mails to include."
  WScript.Echo "  --recent-hours <n>   Only include mails newer than n hours."
  WScript.Echo "  --folders <a;b;c>    Outlook folders to scan."
  WScript.Echo "  --list-folders       Write available Outlook mail folders to --output."
  WScript.Echo "  --body-chars <n>     Body excerpt length."
  WScript.Echo "  --older-than-map <m> Per-folder older-than anchors: Inbox=2026-06-16 10:00:00;Inbox/Sub=..."
  WScript.Echo "  --output <path>      Output markdown path."
  WScript.Echo "  --sample             Generate sample digest or folder list without Outlook."
  WScript.Echo "  --help               Show this message."
End Sub

Sub Fail(byVal message)
  WScript.Echo "ERROR: " & message
  WScript.Quit 1
End Sub
