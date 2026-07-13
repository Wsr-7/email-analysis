import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

test("IsSentFolder guards current EntryID before comparing it under Resume Next", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "scripts", "collect-outlook-mails.vbs"), "utf8");
  const isSentFolder = source.match(/Function IsSentFolder[\s\S]*?End Function/);

  assert.ok(isSentFolder);
  assert.doesNotMatch(isSentFolder[0], /If SafeString\(current\.EntryID\) = sentEntryId Then/);
  assert.match(
    isSentFolder[0],
    /currentEntryId = SafeString\(current\.EntryID\)\r?\n\s*If Err\.Number <> 0 Then\r?\n\s*Err\.Clear\r?\n\s*Exit For\r?\n\s*End If\r?\n\s*If currentEntryId = sentEntryId Then/,
  );
});

test("recipient type is read before its guarded comparison", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "scripts", "collect-outlook-mails.vbs"), "utf8");

  assert.doesNotMatch(source, /If recipient\.Type = recipientType Then/);
  assert.match(source, /recipientTypeValue = recipient\.Type\r?\n\s*If Err\.Number = 0 And recipientTypeValue = recipientType Then/);
});

test("sample mail bodies each contain multiple lines", () => {
  const source = fs.readFileSync(path.join(process.cwd(), "scripts", "collect-outlook-mails.vbs"), "utf8");
  const sampleDigest = source.match(/Sub WriteSampleDigest[\s\S]*?End Sub/);

  assert.ok(sampleDigest);
  const records = sampleDigest[0].match(/^  Set record = BuildSampleRecord.*$/gm) || [];
  assert.equal(records.length, 11);
  assert.ok(records.filter((record) => !record.includes("BuildSampleRecord(11,")).every((record) => (record.match(/vbCrLf/g) || []).length >= 2));
  const longBody = sampleDigest[0].match(/longSampleBody = ([\s\S]*?)\r?\n\s*Set record = BuildSampleRecord\(11, "Long body layout verification"/);
  assert.ok(longBody);
  assert.ok((longBody[1].match(/vbCrLf/g) || []).length >= 23);
});
