// The Office runtime deliberately uses the same fail-closed bootstrap until
// the pinned OnlyOffice/x2t artifact, worker conversion, and malicious corpus
// pass their independent release gates.
document.getElementById("status").textContent =
  "Office editor disabled pending security approval.";
