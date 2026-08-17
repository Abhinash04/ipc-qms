# 7. AI Requirements

## 7.1 Core Principle

**AI recommends. Human decides.** No AI output — assignment recommendation or drafted
response — becomes an official system action without a human explicitly accepting, editing,
or overriding it.

## 7.2 AI-Assisted Assignment

```
Query
+
Query category, subject, required expertise
+
Historical assignments, current workload, division, availability
        ↓
AI
        ↓
Recommendation (official + match score + reason)
        ↓
OIC accepts or overrides
```

Example recommendation:

```
Recommended Official: Neha Singh
Match: 92%
Reason: Strong historical and subject-matter relevance.
```

The OIC must be able to override the recommendation and select a different official; an
override is recorded via the `ASSIGNMENT_OVERRIDDEN` audit event.

## 7.3 AI-Assisted Draft Generation

```
Query
+
Attachments
+
Approved knowledge sources
        ↓
AI
        ↓
Initial Draft
        ↓
Human Editing
        ↓
Review
```

AI-generated content must never automatically become the final official response. Response
versions are preserved, not overwritten:

```
v1 — AI generated
v2 — Officer revision
v3 — Reviewer requested revision
Final — OIC approved
```

## 7.4 Generation Metadata

The system should conceptually retain generation metadata for every AI-produced artifact:

| Field | Purpose |
| --- | --- |
| `generation_id` | Unique identifier for this AI generation event. |
| `query_id` | The query this generation relates to. |
| `model` | Which model produced the output. |
| `prompt_version` | Which prompt/template version was used. |
| `generated_at` | Timestamp. |
| `source_documents` | Knowledge sources the generation drew from. |
| `generated_content` | The raw AI output, prior to any human edit. |

## 7.5 Open Items

Which LLM/provider, whether an external API is permitted, whether an on-prem model is
required, what counts as an "approved knowledge source," and AI citation/audit requirements
are all client clarification items — see
[14-open-questions-and-client-clarifications.md](./14-open-questions-and-client-clarifications.md#ai).
