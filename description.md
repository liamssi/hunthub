# Agent-Native Bug Bounty Hunt Management Platform

## 1. Purpose

The platform is a centralized operating system for managing long-running, agent-assisted bug bounty and security research activities across multiple targets, hunts, agents, and machines.

The platform must solve two separate but interconnected problems:

1. **Preserve and manage individual hunts** as complete, portable investigations that can be paused, moved between machines, and resumed later without losing their filesystem, history, artifacts, configuration, or state.
2. **Build persistent target intelligence** that accumulates knowledge across multiple independent hunts without forcing new agents to inherit the old hunt's methodology, files, prompts, or behavior.

The platform must be designed around autonomous and semi-autonomous agents while keeping the researcher in control.

---

# 2. Fundamental Concepts

The platform has five primary concepts:

### Target

A target is the application, company, domain, API, mobile application, infrastructure, or other security-testing subject being investigated.

A target has persistent knowledge accumulated across multiple hunts.

### Program

A bug bounty/security program defines the rules under which a target may be tested.

It contains scope, exclusions, restrictions, testing requirements, and other program-specific information.

### Hunt

A hunt is a specific investigation against a target/program.

A hunt has its own:

* workspace
* files
* configuration
* methodology
* scaffold
* agents
* recon
* leads
* findings
* evidence
* reports
* logs
* history
* state

A hunt must remain independent from other hunts.

### Agent

An agent is an autonomous or semi-autonomous worker operating on a hunt.

Examples include different coding/security agent systems, custom agents, or the platform's own integrated assistant.

### Target Knowledge

Target Knowledge is persistent intelligence shared across hunts.

It contains useful information discovered during previous investigations without copying the previous hunt itself.

---

# 3. Core Architectural Principle

The platform must maintain a strict separation between:

```text
Target Knowledge
        ↓
Independent Hunts
        ↓
Agents / Machines
```

A new hunt must be able to start with a completely different scaffold, methodology, prompts, and agent behavior while selectively accessing historical knowledge about the target.

The platform must never require copying an old hunt to create a new one.

---

# 4. Portable Hunt Workspaces

Every hunt must have a complete workspace that can exist independently of the central platform.

The workspace may contain:

```text
scope/
recon/
notes/
leads/
findings/
evidence/
reports/
logs/
tool-output/
scripts/
configuration/
```

The exact folder structure must remain under the researcher's control.

The platform must preserve:

* Files
* Directories
* File metadata
* File history
* Hunt configuration
* Agent configuration
* Recon data
* Evidence
* Reports
* Logs
* Tool output
* Scripts
* Current hunt state

A hunt must be exportable and importable.

The researcher must be able to move a hunt from one machine to another and continue working without rebuilding it.

---

# 5. Multi-Machine Hunt Continuity

The same hunt may exist on multiple machines.

For example:

```text
Hunt 183

Laptop
VPS-01
VPS-02
```

The platform must track which machines contain the hunt and their synchronization state.

Required capabilities:

* Workspace synchronization
* Offline operation
* Automatic synchronization when connectivity returns
* Conflict detection
* Conflict resolution
* Replica status
* Last synchronization time
* Missing/modified file detection

A machine failure must not destroy the hunt.

---

# 6. Hunt Versioning and History

The platform must maintain historical versions of important hunt data.

The researcher should be able to see:

* What changed
* Who changed it
* Which agent changed it
* When it changed
* Previous versions
* Differences between versions
* Ability to restore previous versions

Important documents such as findings, leads, reports, notes, and scope information should have reliable history.

---

# 7. Target Knowledge Base

Target knowledge persists independently of hunts.

Example:

```text
Target: example.com

Assets
Endpoints
Technologies
APIs
Authentication mechanisms
Historical observations
Historical findings
Historical leads
Historical testing
Reports
Relationships
```

Each knowledge item should contain provenance such as:

* Source hunt
* Source agent
* Source artifact
* First observed
* Last observed
* Confidence
* Status
* Freshness/staleness

The system must distinguish facts from hypotheses.

For example:

```text
Potential IDOR discovered during Hunt 183
Status: Unvalidated
```

must not become:

```text
Confirmed IDOR
```

simply because it was stored in the knowledge base.

---

# 8. Historical Knowledge Must Not Control New Hunts

A major requirement is preservation of agent creativity and independence.

Starting a new hunt must not automatically import:

* Old prompts
* Old agent behavior
* Old methodology
* Old task ordering
* Old assumptions
* Old workspace
* Old investigation path

Instead, the new hunt can access target knowledge through controlled access modes.

Possible modes:

```text
None
Summary
Selective
Full
```

The preferred model is selective access.

An agent should be able to ask:

> What historical information exists about GraphQL authorization on this target?

and receive relevant historical information without receiving the entire previous investigation.

---

# 9. Leads

Leads represent hypotheses or areas worth investigating.

A lead should have:

* ID
* Title
* Description
* Target
* Hunt
* Source
* Status
* Confidence
* Related assets/endpoints
* Related findings
* Evidence
* Creation time
* Last update
* Last tested
* Agent responsible

Example statuses:

```text
New
Investigating
Validated
Disproven
Stale
Discarded
Promoted
```

Leads should exist both as structured platform objects and, where appropriate, as files inside the hunt workspace.

---

# 10. Findings

Findings represent security issues discovered during a hunt.

A finding should contain:

* Title
* Severity
* Target
* Affected asset
* Endpoint
* Description
* Impact
* Reproduction steps
* Evidence
* Status
* Related leads
* Related artifacts
* Source hunt
* Source agent
* Report
* Submission information
* History

Finding status must be tracked independently from the hunt.

For example:

```text
Unvalidated
Validated
Reported
Duplicate
Informative
Accepted
Rejected
Resolved
```

Historical findings must remain historical. Their existence must not imply that the same vulnerability still exists today.

---

# 11. Observations

The platform must support observations that are neither leads nor vulnerabilities.

Examples:

* An endpoint exists
* A technology was detected
* GraphQL introspection is enabled
* Authentication uses OAuth
* An API behaves differently for different roles

Observations can later become:

```text
Observation
    ↓
Lead
    ↓
Finding
```

or remain useful historical intelligence.

---

# 12. Attack Surface

The platform should maintain a structured representation of the known attack surface.

Examples:

```text
Domains
Subdomains
IPs
Applications
APIs
Endpoints
Mobile applications
Authentication systems
Technologies
Cloud services
```

Each item should have:

* First seen
* Last seen
* Source
* Confidence
* Status
* Related hunts
* Related observations

The attack surface should support historical comparison.

---

# 13. Agent Management

The platform must manage external agents running on different machines.

For each agent:

```text
Agent ID
Agent type
Agent/harness
Machine
Hunt
Target
Status
Current task
Current phase
Start time
Last activity
Last heartbeat
```

Supported agent implementations must be extensible.

The platform should not be tied to one specific agent provider or coding harness.

---

# 14. Agent Monitoring

The researcher needs a central view of all active agents.

The dashboard should show:

```text
Agent
Hunt
Target
Machine
Status
Current activity
Last activity
Current task
Files changed
Pending intervention
Errors
```

The system should detect:

* Agent stopped
* Agent crashed
* Agent disconnected
* Agent idle
* Agent waiting for input
* Agent requiring intervention
* Agent completed its task

---

# 15. Integrated Platform Agent

The platform itself must contain an integrated AI agent.

This is different from the external hunting agents.

Its role is to act as the researcher's **management and orchestration assistant**.

The researcher should be able to ask it natural-language requests such as:

> Show me all active hunts.

> Which agents currently need my attention?

> What did we previously discover about this target?

> Create a new hunt using my preferred scaffold.

> Move this hunt to another machine.

> Summarize the latest activity.

> Review the latest findings.

> Identify stale target intelligence.

> Ask the agent working on Hunt 183 what it is currently doing.

> Pause this agent.

> Start another agent on this hunt.

> Review the unresolved leads from previous hunts.

The integrated agent must be able to operate the platform through controlled tools/actions.

It should not merely be a chatbot sitting beside the dashboard.

---

# 16. Agent-to-Agent Collaboration

Agents should be able to exchange useful information through the platform.

For example:

```text
Claude discovers observation
        ↓
Platform records observation
        ↓
Codex searches platform
        ↓
Codex discovers observation
        ↓
Pi consumes relevant information
```

Agents should not need to share the same filesystem to collaborate.

All important agent actions should retain provenance.

---

# 17. Agent Interface / MCP

The platform must expose a machine-readable agent interface.

Agents should be able to:

* Read hunt information
* Read scope
* Query target knowledge
* Search historical findings
* Search leads
* Create observations
* Create/update leads
* Create/update findings
* Register artifacts
* Read relevant artifacts
* Request human intervention
* Report status
* Communicate with other agents

The interface must be context-aware.

An agent attached to Hunt 183 should automatically understand:

```text
Current hunt
Current target
Current program
Agent identity
Permission scope
Knowledge access level
```

---

# 18. Human-in-the-Loop

Agents must be able to request researcher intervention.

An intervention should include:

* Agent
* Hunt
* Target
* Question
* Context
* Urgency
* Relevant evidence
* Requested action

The researcher should be able to respond from the central interface.

The response should be delivered back to the requesting agent.

---

# 19. Program and Scope Management

The platform must store program rules.

For each program:

* In-scope assets
* Out-of-scope assets
* Vulnerability exclusions
* Testing restrictions
* Rate limits
* Authentication requirements
* Special instructions
* Safe-harbor information
* Program changes
* Source/reference

Agents should be able to query whether a target or asset is within the applicable scope before testing.

---

# 20. Artifact Management

The platform must manage large and small research artifacts.

Examples:

* Screenshots
* HTTP requests/responses
* Videos
* PCAPs
* JSON
* CSV
* Recon results
* Tool databases
* Burp projects
* Logs
* Raw responses

Artifacts should support:

* Metadata
* Versioning
* Hashing
* Search
* Relationships
* Provenance
* Access control
* Preview where possible

Artifacts should be linkable to:

```text
Hunt
Lead
Finding
Observation
Report
Agent
```

---

# 21. Global Search

The researcher should be able to search across the entire platform.

Search targets include:

* Hunts
* Targets
* Assets
* Leads
* Findings
* Observations
* Reports
* Artifacts
* Files
* Agent activity
* Historical testing

Both exact/structured search and semantic search should be supported.

---

# 22. Machine Management

Machines running agents must be registered with the platform.

For each machine:

* Name
* Operating system
* Availability
* Connected agents
* Hunts
* Workspace replicas
* Resource information
* Last heartbeat
* Synchronization state

The platform should show where every active hunt and agent is currently running.

---

# 23. Events and Activity

Important actions should generate events.

Examples:

```text
Hunt created
Hunt resumed
Agent started
Agent stopped
Lead created
Finding updated
Artifact uploaded
Workspace modified
Synchronization conflict
Knowledge updated
Agent intervention requested
Human response received
```

This creates a complete activity timeline.

---

# 24. Notifications

The system should notify the researcher about important events.

Examples:

* Agent requires intervention
* Agent crashed
* Workspace conflict
* Synchronization failure
* New finding
* Report ready
* Important knowledge update

Notifications can eventually support multiple channels.

---

# 25. Reporting

The platform should support:

* Report creation
* Report templates
* Finding → report relationship
* Evidence attachment
* Report versioning
* Human review
* Submission tracking
* External report ID
* Submission status

Submission of reports should remain explicitly controlled by the researcher.

---

# 26. Security and Permissions

The platform will contain sensitive security research information.

It must support:

* User authentication
* Role-based access
* Agent-specific credentials
* Scoped permissions
* Artifact access control
* Audit logs
* Encryption
* Secret management
* Credential protection
* Access history
* Retention policies

Agents should only have the permissions necessary for their current hunt.

---

# 27. Backup and Disaster Recovery

The following must be recoverable:

```text
Hunt workspaces
Git history
Artifacts
Target knowledge
Program information
Agent configuration
Reports
Platform metadata
```

The system must support:

* Automated backups
* Hunt export
* Hunt import
* Knowledge export
* Restore
* Disaster recovery

---

# 28. Automation

The platform should support workflows such as:

```text
Create Hunt
    ↓
Create workspace
    ↓
Load program scope
    ↓
Configure scaffold
    ↓
Create agent credentials
    ↓
Attach machine
    ↓
Start agent
```

And:

```text
Hunt completed
    ↓
Review discoveries
    ↓
Propose target-knowledge updates
    ↓
Human approval
    ↓
Update persistent knowledge
```

---

# 29. Scaffold Management

The platform should track which scaffold/configuration was used for each hunt.

For example:

```text
Hunt 183
    Scaffold: Security-Research-v5
    Methodology: GraphQL-v3
    Agent configuration: v12
```

Scaffolds must remain independent from persistent target knowledge.

A new scaffold should be able to consume historical knowledge without inheriting the old scaffold's behavior.

---

# 30. Core User Experience

The main dashboard should answer, at a glance:

### What am I currently hunting?

### Which agents are running?

### What are they doing?

### Which hunts need my attention?

### What new findings/leads appeared?

### What changed recently?

### What knowledge do we have about this target?

### Which hunts are running on which machines?

### Are any workspaces out of sync?

### Are there conflicts?

### Which agents are waiting for me?

### What can I resume?

---

# 31. Essential Acceptance Criteria

The platform should be considered successful if the following workflow works:

### Scenario A — New hunt

```text
Create Hunt
    ↓
Select program + target
    ↓
Select new scaffold
    ↓
Start agent
    ↓
Agent begins testing
```

### Scenario B — Historical intelligence

```text
New Hunt
    ↓
Different scaffold
    ↓
Different agent behavior
    ↓
Query target knowledge
    ↓
Receive selected historical information
```

### Scenario C — Portable hunt

```text
Hunt running on VPS
    ↓
Synchronize workspace
    ↓
Laptop becomes available
    ↓
Attach laptop to hunt
    ↓
Resume hunt
    ↓
All files/history/state remain available
```

### Scenario D — Multiple agents

```text
Claude → Hunt 183
Codex  → Hunt 183
Pi     → Hunt 183
```

All agents can collaborate through the platform while retaining individual identity and provenance.

### Scenario E — Integrated assistant

```text
Researcher
    ↓
"What needs my attention?"
    ↓
Platform Agent
    ↓
Analyzes hunts + agents + events + interventions
    ↓
Returns actionable summary
```

### Scenario F — Cross-hunt knowledge

```text
Hunt 183 discovers information
          ↓
Persistent target knowledge
          ↓
Hunt 241 starts months later
          ↓
Different scaffold + different agents
          ↓
Queries relevant historical intelligence
```

The result is a platform that functions simultaneously as a **hunt workspace manager, persistent security knowledge base, multi-agent control plane, artifact repository, and researcher assistant**, while keeping individual investigations portable and independent.
