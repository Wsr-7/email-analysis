Option Explicit

Dim fso
Set fso = CreateObject("Scripting.FileSystemObject")

Dim args
Set args = WScript.Arguments

Dim config
Set config = CreateObject("Scripting.Dictionary")
config.CompareMode = 1
config.Add "days-ahead", 2
config.Add "body-chars", 500
config.Add "output", ""
config.Add "sample", False
config.Add "help", False

ParseArgs args, config

If config("help") Then
  PrintUsage
  WScript.Quit 0
End If

If config("output") = "" Then
  config("output") = fso.BuildPath(GetScriptDirectory(), "..\data\meeting-digest.md")
End If

EnsureParentFolder config("output")

If CBool(config("sample")) Then
  WriteSampleMeetingDigest config("output"), config
  WScript.Echo "Generated sample meeting digest at: " & config("output")
  WScript.Quit 0
End If

CollectMeetings config("output"), config
WScript.Echo "Generated meeting digest at: " & config("output")

Sub ParseArgs(byVal cliArgs, byRef target)
  Dim i
  For i = 0 To cliArgs.Count - 1
    Dim current
    current = LCase(cliArgs(i))

    Select Case current
      Case "--days-ahead", "--body-chars", "--output"
        Dim key
        key = Mid(current, 3)
        If i + 1 < cliArgs.Count Then
          target(key) = cliArgs(i + 1)
          i = i + 1
        End If
      Case "--sample"
        target("sample") = True
      Case "--help", "-h"
        target("help") = True
    End Select
  Next
End Sub

Sub PrintUsage()
  WScript.Echo "Usage: cscript collect-outlook-meetings.vbs [options]"
  WScript.Echo ""
  WScript.Echo "Options:"
  WScript.Echo "  --days-ahead N    Days ahead to fetch (default: 2, means today + 2 days)"
  WScript.Echo "  --body-chars N    Max body characters (default: 500)"
  WScript.Echo "  --output PATH     Output file path"
  WScript.Echo "  --sample          Generate sample data without Outlook"
  WScript.Echo "  --help            Show this help"
End Sub

Sub CollectMeetings(byVal outputPath, byRef target)
  On Error Resume Next
  Dim outlook
  Set outlook = CreateObject("Outlook.Application")
  If Err.Number <> 0 Then
    Fail "Unable to create Outlook.Application. " & Err.Description
  End If
  On Error GoTo 0

  Dim ns
  Set ns = outlook.GetNamespace("MAPI")

  Dim daysAhead
  daysAhead = CLng(target("days-ahead"))
  Dim bodyChars
  bodyChars = CLng(target("body-chars"))

  Dim todayStart
  todayStart = DateValue(Now)
  Dim rangeEnd
  rangeEnd = DateAdd("d", daysAhead + 1, todayStart)

  Dim collected()
  Dim collectedCount
  collectedCount = 0
  Dim seenEntryIds
  Set seenEntryIds = CreateObject("Scripting.Dictionary")
  seenEntryIds.CompareMode = 1

  CollectCalendarItems ns, todayStart, rangeEnd, bodyChars, collected, collectedCount, seenEntryIds
  CollectUnrespondedInvites ns, todayStart, bodyChars, collected, collectedCount, seenEntryIds

  SortMeetingRecords collected, collectedCount
  WriteMeetingDigest outputPath, target, collected, collectedCount
End Sub

Sub CollectCalendarItems(byRef ns, byVal rangeStart, byVal rangeEnd, byVal bodyChars, byRef collected, byRef collectedCount, byRef seenEntryIds)
  On Error Resume Next
  Dim calFolder
  Set calFolder = ns.GetDefaultFolder(9)
  If Err.Number <> 0 Then
    Err.Clear
    On Error GoTo 0
    Exit Sub
  End If
  On Error GoTo 0

  Dim items
  Set items = calFolder.Items
  items.Sort "[Start]"
  items.IncludeRecurrences = True

  Dim startFilter
  startFilter = FormatRestrictDate(rangeStart)
  Dim endFilter
  endFilter = FormatRestrictDate(rangeEnd)

  On Error Resume Next
  Dim restricted
  Set restricted = items.Restrict("[Start] >= '" & startFilter & "' AND [Start] < '" & endFilter & "'")
  If Err.Number <> 0 Then
    Err.Clear
    On Error GoTo 0
    Exit Sub
  End If
  On Error GoTo 0

  ' items.IncludeRecurrences = True makes restricted.Count unreliable (lazy expansion of
  ' recurring instances can report 0 or a bogus value), so index-based iteration silently
  ' misses every meeting. Walk the collection with GetFirst/GetNext instead. The collection
  ' is sorted ascending by Start, so once an instance's Start reaches rangeEnd we can stop
  ' (also guards against IncludeRecurrences + Restrict occasionally letting instances outside
  ' the filtered range slip through). A 200-item fuse still guards against runaway iteration.
  On Error Resume Next
  Dim item
  Set item = restricted.GetFirst()
  Dim gotFirst
  gotFirst = (Err.Number = 0)
  Err.Clear
  On Error GoTo 0
  If Not gotFirst Then Exit Sub

  Dim iterations
  iterations = 0
  Do While Not item Is Nothing
    iterations = iterations + 1
    If iterations > 200 Then Exit Do

    On Error Resume Next
    Dim itemStart
    itemStart = item.Start
    Dim gotStart
    gotStart = (Err.Number = 0)
    Err.Clear
    On Error GoTo 0
    If gotStart Then
      If itemStart >= rangeEnd Then Exit Do
    End If

    If TypeName(item) = "AppointmentItem" Then
      Dim respStatus
      respStatus = SafeResponseStatus(item)
      If respStatus <> 4 Then
        Dim eid
        eid = SafeString(item.EntryID)
        If eid <> "" And Not seenEntryIds.Exists(eid) Then
          seenEntryIds.Add eid, True
          Dim record
          Set record = BuildMeetingRecord(item, "calendar", bodyChars, collectedCount + 1)
          AddRecordToArray collected, collectedCount, record
        End If
      End If
    End If

    If collectedCount >= 200 Then Exit Do

    On Error Resume Next
    Set item = restricted.GetNext()
    If Err.Number <> 0 Then
      Err.Clear
      On Error GoTo 0
      Exit Do
    End If
    On Error GoTo 0
  Loop
End Sub

Sub CollectUnrespondedInvites(byRef ns, byVal todayStart, byVal bodyChars, byRef collected, byRef collectedCount, byRef seenEntryIds)
  On Error Resume Next
  Dim inbox
  Set inbox = ns.GetDefaultFolder(6)
  If Err.Number <> 0 Then
    Err.Clear
    On Error GoTo 0
    Exit Sub
  End If
  On Error GoTo 0

  Dim items
  Set items = inbox.Items
  items.Sort "[ReceivedTime]", True

  Dim cutoff
  cutoff = DateAdd("d", -7, Now)

  On Error Resume Next
  Dim restricted
  Set restricted = items.Restrict("[MessageClass] = 'IPM.Schedule.Meeting.Request' AND [ReceivedTime] >= '" & FormatRestrictDate(cutoff) & "'")
  If Err.Number <> 0 Then
    Err.Clear
    On Error GoTo 0
    Exit Sub
  End If
  On Error GoTo 0

  Dim i
  For i = 1 To restricted.Count
    On Error Resume Next
    Dim item
    Set item = restricted.Item(i)
    If Err.Number <> 0 Then
      Err.Clear
      On Error GoTo 0
    Else
      On Error GoTo 0
      If Not item Is Nothing Then
        If TypeName(item) = "MeetingItem" Then
          On Error Resume Next
          Dim appt
          Set appt = item.GetAssociatedAppointment(False)
          If Err.Number <> 0 Then
            Err.Clear
            On Error GoTo 0
          Else
            On Error GoTo 0
            If Not appt Is Nothing Then
              Dim apptStart
              apptStart = appt.Start
              Dim respStatus2
              respStatus2 = SafeResponseStatus(appt)
              If apptStart >= todayStart And respStatus2 = 0 Then
                Dim eid2
                eid2 = SafeString(appt.EntryID)
                If eid2 <> "" And Not seenEntryIds.Exists(eid2) Then
                  seenEntryIds.Add eid2, True
                  Dim record2
                  Set record2 = BuildMeetingRecord(appt, "invite", bodyChars, collectedCount + 1)
                  AddRecordToArray collected, collectedCount, record2
                End If
              End If
            End If
          End If
        End If
      End If
    End If
    If collectedCount >= 200 Then Exit For
  Next
End Sub

Function BuildMeetingRecord(byRef appt, byVal source, byVal bodyChars, byVal recordIndex)
  Dim record
  Set record = CreateObject("Scripting.Dictionary")
  record.CompareMode = 1
  record.Add "meetingId", "mtg-" & Right("000" & CStr(recordIndex), 3)
  record.Add "entryId", SafeString(appt.EntryID)
  record.Add "subject", SafeString(appt.Subject)
  record.Add "organizer", SafeString(appt.Organizer)
  record.Add "start", FormatDateValue(appt.Start)
  record.Add "end", FormatDateValue(appt.End)
  record.Add "location", SafeString(appt.Location)
  record.Add "isAllDay", LCase(CStr(CBool(appt.AllDayEvent)))
  record.Add "isRecurring", LCase(CStr(CBool(appt.IsRecurring)))
  record.Add "requiredAttendees", SafeString(appt.RequiredAttendees)
  record.Add "optionalAttendees", SafeString(appt.OptionalAttendees)
  record.Add "responseStatus", ResponseStatusLabel(SafeResponseStatus(appt))
  record.Add "meetingSource", source
  record.Add "importance", ImportanceLabel(appt.Importance)
  record.Add "sortKey", Replace(FormatDateValue(appt.Start), " ", "T")
  record.Add "bodyExcerpt", TruncateText(SafeBody(appt), bodyChars)
  Set BuildMeetingRecord = record
End Function

Function SafeResponseStatus(byRef appt)
  On Error Resume Next
  SafeResponseStatus = appt.ResponseStatus
  If Err.Number <> 0 Then
    Err.Clear
    SafeResponseStatus = 0
  End If
  On Error GoTo 0
End Function

Function ResponseStatusLabel(byVal status)
  Select Case status
    Case 0: ResponseStatusLabel = "notResponded"
    Case 1: ResponseStatusLabel = "organizer"
    Case 2: ResponseStatusLabel = "tentative"
    Case 3: ResponseStatusLabel = "accepted"
    Case 4: ResponseStatusLabel = "declined"
    Case Else: ResponseStatusLabel = "notResponded"
  End Select
End Function

Function ImportanceLabel(byVal importance)
  Select Case importance
    Case 0: ImportanceLabel = "Low"
    Case 1: ImportanceLabel = "Normal"
    Case 2: ImportanceLabel = "High"
    Case Else: ImportanceLabel = "Normal"
  End Select
End Function

Sub SortMeetingRecords(byRef records, byVal recordCount)
  If recordCount < 2 Then Exit Sub
  Dim i, j
  For i = 0 To recordCount - 2
    For j = i + 1 To recordCount - 1
      If records(i)("sortKey") > records(j)("sortKey") Then
        Dim tmp
        Set tmp = records(i)
        Set records(i) = records(j)
        Set records(j) = tmp
      End If
    Next
  Next
End Sub

Sub WriteMeetingDigest(byVal outputPath, byRef target, byRef records, byVal recordCount)
  Dim content
  content = "# Outlook Meeting Digest" & vbCrLf & vbCrLf
  content = content & "GeneratedAt: " & FormatDateValue(Now) & vbCrLf
  content = content & "DaysAhead: " & target("days-ahead") & vbCrLf
  content = content & vbCrLf & "---" & vbCrLf

  Dim index
  For index = 0 To recordCount - 1
    Dim record
    Set record = records(index)
    content = content & vbCrLf
    content = content & "## Meeting: " & record("meetingId") & vbCrLf & vbCrLf
    content = content & "EntryId: " & EscapeMarkdownInline(record("entryId")) & vbCrLf
    content = content & "Subject: " & EscapeMarkdownInline(record("subject")) & vbCrLf
    content = content & "Organizer: " & EscapeMarkdownInline(record("organizer")) & vbCrLf
    content = content & "Start: " & record("start") & vbCrLf
    content = content & "End: " & record("end") & vbCrLf
    content = content & "Location: " & EscapeMarkdownInline(record("location")) & vbCrLf
    content = content & "IsAllDay: " & record("isAllDay") & vbCrLf
    content = content & "IsRecurring: " & record("isRecurring") & vbCrLf
    content = content & "RequiredAttendees: " & EscapeMarkdownInline(record("requiredAttendees")) & vbCrLf
    content = content & "OptionalAttendees: " & EscapeMarkdownInline(record("optionalAttendees")) & vbCrLf
    content = content & "ResponseStatus: " & record("responseStatus") & vbCrLf
    content = content & "MeetingSource: " & record("meetingSource") & vbCrLf
    content = content & "Importance: " & record("importance") & vbCrLf & vbCrLf
    content = content & "BodyExcerpt:" & vbCrLf
    content = content & EscapeMarkdownBlock(record("bodyExcerpt")) & vbCrLf & vbCrLf
    content = content & "---" & vbCrLf
  Next

  WriteTextFile outputPath, content
End Sub

Sub WriteSampleMeetingDigest(byVal outputPath, byRef target)
  Dim records()
  Dim recordCount
  recordCount = 0

  Dim todayDate
  todayDate = FormatDateOnly(Now)
  Dim tomorrowDate
  tomorrowDate = FormatDateOnly(DateAdd("d", 1, Now))
  Dim dayAfterDate
  dayAfterDate = FormatDateOnly(DateAdd("d", 2, Now))

  Dim record

  Set record = BuildSampleMeetingRecord(1, "Team Daily Standup", "Alice Johnson", todayDate & " 09:30", todayDate & " 10:00", "Conference Room A", False, True, "bob@example.com; carol@example.com", "dave@example.com", "accepted", "calendar", "Let's sync on sprint progress and blockers.")
  AddRecordToArray records, recordCount, record

  Set record = BuildSampleMeetingRecord(2, "Client Review - Project Alpha", "External Client", tomorrowDate & " 14:00", tomorrowDate & " 15:30", "Teams Meeting", False, False, "alice@example.com; bob@example.com; client@partner.com", "", "notResponded", "invite", "Please prepare the Q3 progress report for review.")
  AddRecordToArray records, recordCount, record

  Set record = BuildSampleMeetingRecord(3, "Company All Hands", "CEO", dayAfterDate & " 16:00", dayAfterDate & " 17:00", "Main Auditorium / Teams", False, False, "all-staff@example.com", "", "tentative", "calendar", "Quarterly results and roadmap update.")
  AddRecordToArray records, recordCount, record

  Set record = BuildSampleMeetingRecord(4, "1:1 with Manager", "You", todayDate & " 11:00", todayDate & " 11:30", "Teams Meeting", False, True, "manager@example.com", "", "organizer", "calendar", "")
  AddRecordToArray records, recordCount, record

  WriteMeetingDigest outputPath, target, records, recordCount
End Sub

Function BuildSampleMeetingRecord(byVal idx, byVal subj, byVal org, byVal startTime, byVal endTime, byVal loc, byVal allDay, byVal recurring, byVal reqAtt, byVal optAtt, byVal respStatus, byVal source, byVal body)
  Dim record
  Set record = CreateObject("Scripting.Dictionary")
  record.CompareMode = 1
  record.Add "meetingId", "mtg-" & Right("000" & CStr(idx), 3)
  record.Add "entryId", "sample-meeting-" & CStr(idx)
  record.Add "subject", subj
  record.Add "organizer", org
  record.Add "start", startTime
  record.Add "end", endTime
  record.Add "location", loc
  record.Add "isAllDay", LCase(CStr(allDay))
  record.Add "isRecurring", LCase(CStr(recurring))
  record.Add "requiredAttendees", reqAtt
  record.Add "optionalAttendees", optAtt
  record.Add "responseStatus", respStatus
  record.Add "meetingSource", source
  record.Add "importance", "Normal"
  record.Add "sortKey", Replace(startTime, " ", "T")
  record.Add "bodyExcerpt", body
  Set BuildSampleMeetingRecord = record
End Function

Sub AddRecordToArray(byRef arr, byRef count, byRef record)
  If count = 0 Then
    ReDim arr(0)
  Else
    ReDim Preserve arr(count)
  End If
  Set arr(count) = record
  count = count + 1
End Sub

Function FormatDateValue(byVal dateValue)
  FormatDateValue = Year(dateValue) & "-" & Right("0" & Month(dateValue), 2) & "-" & Right("0" & Day(dateValue), 2) & " " & Right("0" & Hour(dateValue), 2) & ":" & Right("0" & Minute(dateValue), 2)
End Function

Function FormatDateOnly(byVal dateValue)
  FormatDateOnly = Year(dateValue) & "-" & Right("0" & Month(dateValue), 2) & "-" & Right("0" & Day(dateValue), 2)
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

Function SafeString(byVal value)
  On Error Resume Next
  SafeString = CStr(value)
  If Err.Number <> 0 Then
    Err.Clear
    SafeString = ""
  End If
  On Error GoTo 0
  If IsNull(SafeString) Then SafeString = ""
End Function

Function SafeBody(byRef appt)
  On Error Resume Next
  SafeBody = SafeString(appt.Body)
  If Err.Number <> 0 Then
    Err.Clear
    SafeBody = ""
  End If
  On Error GoTo 0
End Function

Function TruncateText(byVal text, byVal maxLen)
  If Len(text) <= maxLen Then
    TruncateText = text
  Else
    TruncateText = Left(text, maxLen) & "..."
  End If
End Function

Function EscapeMarkdownInline(byVal text)
  EscapeMarkdownInline = Replace(Replace(SafeString(text), vbCr, ""), vbLf, " ")
End Function

Function EscapeMarkdownBlock(byVal text)
  EscapeMarkdownBlock = SafeString(text)
End Function

Sub WriteTextFile(byVal filePath, byVal content)
  Dim stream
  Set stream = CreateObject("ADODB.Stream")
  stream.Type = 2
  stream.Charset = "utf-8"
  stream.Open
  stream.WriteText content
  stream.SaveToFile filePath, 2
  stream.Close
End Sub

Sub EnsureParentFolder(byVal filePath)
  Dim parentPath
  parentPath = fso.GetParentFolderName(filePath)
  If parentPath <> "" And Not fso.FolderExists(parentPath) Then
    fso.CreateFolder parentPath
  End If
End Sub

Function GetScriptDirectory()
  GetScriptDirectory = fso.GetParentFolderName(WScript.ScriptFullName)
End Function

Sub Fail(byVal message)
  WScript.StdErr.Write "ERROR: " & message & vbCrLf
  WScript.Quit 1
End Sub
