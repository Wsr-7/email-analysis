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
  config("output") = fso.BuildPath(GetScriptDirectory(), "..\data\mail-digest.md")
End If

EnsureParentFolder config("output")

If CBool(config("sample")) Then
  WriteSampleDigest config("output"), config
  WScript.Echo "Generated sample digest at: " & config("output")
  WScript.Quit 0
End If

CollectFromOutlook config("output"), config
WScript.Echo "Generated digest at: " & config("output")

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
      Case "--help", "-h", "/?"
        target("help") = True
      Case Else
        Fail "Unknown argument: " & cliArgs(i)
    End Select
  Next
End Sub

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

  Dim idx
  For idx = 0 To UBound(folderNames)
    Dim folderPath
    folderPath = Trim(folderNames(idx))
    If folderPath <> "" Then
      CollectFolderItems ns, folderPath, CStr(target("range-mode")), CLng(target("max-items")), CLng(target("recent-hours")), CLng(target("body-chars")), OlderThanForFolder(target("older-than-map"), folderPath), collected, collectedCount
    End If
  Next

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
  WriteDigest outputPath, target, collected, collectedCount
End Sub

Sub CollectFolderItems(byRef ns, byVal folderPath, byVal rangeMode, byVal maxItems, byVal recentHours, byVal bodyChars, byVal olderThan, byRef collected, byRef collectedCount)
  Dim folder
  Set folder = ResolveFolder(ns, folderPath)
  If folder Is Nothing Then
    Fail "Outlook folder not found: " & folderPath
  End If

  Dim timeProperty
  timeProperty = FolderTimeProperty(folderPath)

  Dim items
  Set items = folder.Items
  Dim totalItems
  totalItems = SafeItemsCount(items)

  If Trim(CStr(olderThan)) <> "" Then
    On Error Resume Next
    Dim restricted
    Set restricted = items.Restrict("[" & timeProperty & "] < '" & FormatRestrictDate(ParseAnchorDate(olderThan)) & "'")
    If Err.Number <> 0 Then
      Fail "Unable to restrict Outlook folder by " & timeProperty & ": " & folderPath & ". " & Err.Description
    End If
    On Error GoTo 0
    Set items = restricted
  End If
  Dim candidateItems
  candidateItems = SafeItemsCount(items)
  items.Sort "[" & timeProperty & "]", True

  Dim cutoffEnabled
  cutoffEnabled = IsRecentHoursMode(rangeMode)
  Dim cutoff
  If cutoffEnabled Then
    cutoff = DateAdd("h", -recentHours, Now)
  End If

  Dim scanned
  scanned = 0
  Dim addedInFolder
  addedInFolder = 0
  Dim capEnabled
  capEnabled = IsMaxItemsMode(rangeMode)

  Dim i
  For i = 1 To items.Count
    On Error Resume Next
    Dim item
    Set item = items.Item(i)
    If Err.Number <> 0 Then
      Err.Clear
      On Error GoTo 0
    Else
      On Error GoTo 0
      If Not item Is Nothing Then
        If TypeName(item) = "MailItem" Then
          Dim sortDate
          sortDate = MailSortDate(item, folderPath)
          If IsAcceptableMailDate(sortDate) And ((Not cutoffEnabled) Or sortDate >= cutoff) Then
            Dim record
            Set record = BuildMailRecord(item, folderPath, bodyChars, collectedCount + 1)
            AddRecordToArray collected, collectedCount, record
            scanned = scanned + 1
            addedInFolder = addedInFolder + 1
            If capEnabled And scanned >= maxItems Then
              Exit For
            End If
          End If
        End If
      End If
    End If
  Next
  WScript.Echo "FolderScan: folder=" & folderPath & "; mode=" & rangeMode & "; timeProperty=" & timeProperty & "; totalItems=" & totalItems & "; candidateItems=" & candidateItems & "; added=" & addedInFolder & "; maxItems=" & maxItems & "; recentHours=" & recentHours & "; olderThan=" & ValueOrDash(olderThan)
End Sub

Function IsRecentHoursMode(byVal rangeMode)
  IsRecentHoursMode = (LCase(Trim(CStr(rangeMode))) = "recenthours")
End Function

Function IsMaxItemsMode(byVal rangeMode)
  IsMaxItemsMode = Not IsRecentHoursMode(rangeMode)
End Function

Function FolderTimeProperty(byVal folderPath)
  If LCase(Trim(CStr(folderPath))) = "sent items" Then
    FolderTimeProperty = "SentOn"
  Else
    FolderTimeProperty = "ReceivedTime"
  End If
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
  If LCase(root) = "inbox" Then
    Set folder = ns.GetDefaultFolder(6)
  ElseIf LCase(root) = "sent items" Then
    Set folder = ns.GetDefaultFolder(5)
  ElseIf LCase(root) = "drafts" Then
    Set folder = ns.GetDefaultFolder(16)
  Else
    Set folder = ns.Folders(root)
  End If

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

Function BuildMailRecord(byRef mail, byVal folderPath, byVal bodyChars, byVal recordIndex)
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
  record.Add "senderName", SafeString(mail.SenderName)
  record.Add "senderEmail", SafeSenderEmail(mail)
  record.Add "receivedTime", FormatDateValue(MailSortDate(mail, folderPath))
  record.Add "sentTime", SafeDateValue(mail.SentOn)
  record.Add "sortKey", Replace(FormatDateValue(MailSortDate(mail, folderPath)), " ", "T")
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

Function MailSortDate(byRef mail, byVal folderPath)
  On Error Resume Next
  If FolderTimeProperty(folderPath) = "SentOn" Then
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
  On Error Resume Next
  SafeSenderEmail = SafeString(mail.SenderEmailAddress)
  If Err.Number <> 0 Then
    Err.Clear
    SafeSenderEmail = ""
  End If
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
  On Error Resume Next
  SafeTo = SafeString(mail.To)
  If Err.Number <> 0 Then
    Err.Clear
    SafeTo = ""
  End If
  On Error GoTo 0
End Function

Function SafeCc(byRef mail)
  On Error Resume Next
  SafeCc = SafeString(mail.CC)
  If Err.Number <> 0 Then
    Err.Clear
    SafeCc = ""
  End If
  On Error GoTo 0
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

Sub WriteDigest(byVal outputPath, byRef target, byRef records, byVal recordCount)
  Dim content
  content = "# Outlook Mail Digest" & vbCrLf & vbCrLf
  content = content & "GeneratedAt: " & FormatDateValue(Now) & vbCrLf
  content = content & "RangeMode: " & target("range-mode") & vbCrLf
  content = content & "RecentHours: " & target("recent-hours") & vbCrLf
  content = content & "MaxItems: " & target("max-items") & vbCrLf
  content = content & "Folders:" & vbCrLf

  Dim folderNames
  folderNames = Split(CStr(target("folders")), ";")
  Dim i
  For i = 0 To UBound(folderNames)
    content = content & "- " & Trim(folderNames(i)) & vbCrLf
  Next

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

  Set record = BuildSampleRecord(1, "Contract approval needed", "Alice", "alice@example.com", "Inbox/Customer", "high", True, False, "Please review and approve the contract before EOD today.")
  record("conversationId") = "sample-thread-contract"
  record("conversationIndex") = "0001"
  record("attachmentCount") = 1
  record("attachmentNames") = "contract.pdf"
  AddRecordToArray records, recordCount, record
  Set record = BuildSampleRecord(2, "Weekly system notice", "No Reply", "no-reply@example.com", "Inbox/Notice", "normal", True, True, "This is the weekly system notification for the shared platform.")
  AddRecordToArray records, recordCount, record
  Set record = BuildSampleRecord(3, "Need your review on Q3 budget", "Bob", "bob@example.com", "Inbox/Project A", "high", True, False, "Please check the attached budget assumptions and send comments today.")
  record("attachmentCount") = 1
  record("attachmentNames") = "budget.xlsx"
  AddRecordToArray records, recordCount, record
  Set record = BuildSampleRecord(4, "Follow-up: customer workshop next week", "Carol", "carol@example.com", "Inbox/Customer", "normal", False, False, "Waiting for your confirmation on the workshop agenda and attendee list.")
  record("conversationId") = "sample-thread-contract"
  record("conversationIndex") = "0002"
  AddRecordToArray records, recordCount, record

  WriteDigest outputPath, target, records, recordCount
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
  WScript.Echo "  --body-chars <n>     Body excerpt length."
  WScript.Echo "  --older-than-map <m> Per-folder older-than anchors: Inbox=2026-06-16 10:00:00;Inbox/Sub=..."
  WScript.Echo "  --output <path>      Output markdown path."
  WScript.Echo "  --sample             Generate sample digest without Outlook."
  WScript.Echo "  --help               Show this message."
End Sub

Sub Fail(byVal message)
  WScript.Echo "ERROR: " & message
  WScript.Quit 1
End Sub
