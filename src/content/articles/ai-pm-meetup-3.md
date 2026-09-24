---
title: "Four agents, one that writes, and five ways to test them"
dek: "How Gabriel Lima keeps AI agents out of Jira until he says go, how Diana Ferreira's team tests an AI agent before customers see it, and how Rezonant helps whole teams work with agents. Notes and slides from our third AI PM Meetup."
date: 2026-09-24
eyebrow: "AI PM Meetup #3 · Porto"
author:
  name: Javier Navero
  role: Co-founder, The Impostor PM
  avatar: /articles/authors/javier-navero.jpg
editorNote: "We started the AI PM Meetup with one rule: whoever is on stage shows what they're actually doing with AI at work, whether that's building it into their product or using it to do their own job. We wanted to see how companies in different industries are adapting. The third edition was in Porto on September 17, 2026, and I've written it up for anyone who couldn't make it, with the slides at the end."
speakers:
  - name: Gabriel Lima
    role: Product Visionary at CTW, founding partner at Arvore
    bio: "Gabriel co-founded Arvore and joined CTW in 2024 to work on BMW. He built Odyssey, the crew of agents in this article."
    url: https://www.linkedin.com/in/sougablima/
    avatar: /articles/speakers/gabriel-lima.jpg
  - name: Diana Ferreira
    role: Staff PM at Overstory
    bio: "Diana is a Staff PM at Overstory, which builds risk intelligence for electric utilities. Her team ships an AI agent on top of their own MCP server."
    url: https://www.linkedin.com/in/dianaguedesferreira/
    avatar: /articles/speakers/diana-ferreira.jpg
  - name: Sam Walker
    role: Founding designer at Rezonant
    bio: "Sam is a founding designer at Rezonant, which helps PMs and their teams work with AI agents. Rezonant is a partner of The Impostor PM."
    url: https://www.linkedin.com/in/sam-walker-44633311b/
    avatar: /articles/speakers/sam-walker.jpg
slidesUrl: https://drive.google.com/drive/folders/1cVd1jK1XjeNwqiWNqwOb_iykkXc2Tbhx?usp=sharing
seo:
  title: "How PMs test and trust AI agents: AI PM Meetup #3"
  description: "How Gabriel Lima keeps AI agents out of Jira until he says go, and how Diana Ferreira's team evaluates an AI agent. Notes and slides from our AI PM Meetup."
---

This third edition had three talks. Gabriel Lima uses AI agents to do PM work in a domain he was still learning. Diana Ferreira's team ships an AI agent inside their product and has to prove it works. Those two came at AI from opposite ends and ended up at the same question: how do you know the AI got it right before it matters? And Sam Walker, from Rezonant, showed how PMs and their teams can work with AI agents together.

All the slides are [at the end of this article](#slides).

## Gabriel Lima: a crew of agents you can actually trust

For nine years Gabriel was the informal PM at Arvore, a company he co-founded. He knew those products inside out. In 2024 he left and joined CTW to work on BMW, which he calls the most complex thing he's worked on: huge old systems, tons of jargon, real stakes, and a domain he barely knew.

He had to get up to speed fast without getting things wrong, and that made him look at AI differently: when you can't yet check an answer yourself, a confident mistake is worse than no answer at all.

He opened with a question for the room: would you paste your real backlog into ChatGPT? Most people wouldn't. Gabriel's point was that the models can already do a lot of this work, and what holds people back is trust.

### Three problems with a normal chatbot

He named three things that stop PMs from using AI on real work:

1. **It makes things up.** A field name, a "fact" about your system, a quote from a doc that doesn't exist. And it sounds right.
2. **It acts without asking.** Give it write access and "tidy up my board" can turn into changes you never approved. There's no undo on a shared Jira.
3. **It forgets your project.** Every new chat, you explain the project, the team and the rules again.

So he built a setup he could check and control.

### The crew

His setup, which he calls Odyssey, runs in VS Code with GitHub Copilot, connected to Jira and Confluence through MCP. Gabriel describes MCP as "the USB port that lets an agent actually read and write real tools". It has four agents, each with a job and a set of permissions.

<div class="art-crew">
  <div class="art-agent">
    <p class="art-agent-name">Ground Control</p>
    <p>The only one Gabriel talks to. Works out who should do what, keeps the context and passes on his go-ahead.</p>
    <span class="art-pill">Coordinates</span>
  </div>
  <div class="art-agent art-agent--writes">
    <p class="art-agent-name">Major Tom</p>
    <p>Does the actual work. Reads the real systems and writes to them.</p>
    <span class="art-pill art-pill--gold">The only one that writes</span>
  </div>
  <div class="art-agent">
    <p class="art-agent-name">Sagan</p>
    <p>The explainer. Breaks down the tech and helps with Scrum and strategy.</p>
    <span class="art-pill">Reads and advises</span>
  </div>
  <div class="art-agent">
    <p class="art-agent-name">Houston</p>
    <p>The skeptic. Pokes holes in Gabriel's work and in the other agents' answers.</p>
    <span class="art-pill">Reads and challenges</span>
  </div>
</div>

The names come from Bowie's "Space Oddity" and Apollo 13, but the important part is how the work is split. Only Major Tom can write; the other three can read, advise or challenge. That split is what lets Gabriel connect the crew to real systems at all.

Under the hood there are four layers: rules every agent obeys, 24 skills (playbooks for things like writing backlog items, splitting stories, prioritization or Monte Carlo simulations), examples of what good output looks like, and the agents themselves. On top sits a memory and an audit log. When two rules clash, the stricter one wins. Gabriel never calls a skill by name. He asks in plain language and the right agent picks it up.

### The rules it can't break

- **It looks things up.** It learns each project live, so nothing about a company is hardcoded.
- **It writes nothing until he says a specific word.** Everything starts as a draft, and only Major Tom writes.
- **It cites every claim, or admits it can't.** Each claim is tagged high confidence (read from a documented source), medium (from an issue or an inference) or low (an assumption, always declared).

Each rule is there to fix one of the three problems he opened with.

### The gate

Anything that touches a real system goes through the same four steps.

<ol class="art-steps">
  <li><strong>You ask</strong> for anything that would change a real system.</li>
  <li><strong>Draft and preview.</strong> The crew shows it in the chat, with sources. Nothing is written yet.</li>
  <li class="art-steps-key"><strong>You say the word.</strong> One of <em>publish</em>, <em>execute</em>, <em>create in jira</em>, <em>go ahead</em> or <em>approved</em>.</li>
  <li><strong>Major Tom writes</strong> exactly what you saw, and logs it.</li>
</ol>

"Looks good", a thumbs-up or silence don't count. Anything destructive needs a second, specific confirmation.

### The demo: from a rough idea to a Jira story

Gabriel replayed a real chat, with client, system and people names removed. The project involves moving parts data from an old system to a new one.

He asked Ground Control for a story: when a part comes from the new data source, its launch attributes should be pre-filled, so the data steward doesn't have to re-enter them by hand.

- Major Tom read the Jira project's configuration and found the real story template and the ID of the acceptance criteria field. It didn't assume either. It marked that as high confidence and cited where it came from.
- It drafted the story with two acceptance criteria and left the estimate empty on purpose. Sizing is the team's job in refinement.
- It flagged one part as medium confidence: the event that triggers the pre-fill was inferred from Gabriel's request, so he needed to confirm the name.
- Houston then challenged the draft. What happens when the source has no value? Blank the field, keep the old value? A silent default, it argued, becomes a data bug nobody can trace later.
- Gabriel agreed: leave it blank and editable, and never invent a default. Major Tom added that as a third criterion.
- The preview said, in capitals, that nothing was in Jira yet. Gabriel typed "create in jira", and only then was the story created and the write logged, including what was written, when, and his authorization.

By the end he had a story ready for refinement, with a source for every claim, and it only reached Jira because he typed the keyword.

### What he measured

Gabriel was careful to show only numbers he could back up, taken from Jira, Confluence and his own log.

<div class="art-stats">
  <div><p class="art-stat">3,163</p><p>pages in the team's knowledge base the crew can search in seconds</p></div>
  <div><p class="art-stat">8</p><p>sources one real epic ended up grounded in, starting from an empty template</p></div>
  <div><p class="art-stat">~10</p><p>mistakes caught before they shipped, across 10 review passes</p></div>
  <div><p class="art-stat">66</p><p>backlog items and 8 pages in 8 weeks, every write approved by him</p></div>
</div>

He didn't show an "hours saved" number. His slide said he wasn't going to make one up, and that the demo was the honest proof of speed. It fit a talk about not letting AI invent things.

### The same crew, pointed earlier

The same rules work on incoming requests too. Gabriel's example: "Add an Export-to-Excel button to the dashboard. Finance asked for it." That's a solution with the problem assumed.

Houston hands back what the request implies (someone needs the numbers somewhere else), the evidence (one stakeholder asked, no usage data, medium confidence), the questions to answer first (what do they do with the data, how often, is there already a report?) and a verdict: needs discovery first. Because the crew isn't allowed to invent the problem, "we don't have evidence yet" is a useful answer on its own.

### Even the skeptic gets it wrong

Once, Houston "corrected" Gabriel using a file that didn't exist. So now he checks the skeptic too. The system assumes any part of it can be wrong, including the AI that checks the other AI.

His conclusion was that he trusts the system around the AI more than the AI itself. Sources, his explicit go-ahead and a skeptic in the loop keep things safe even when the model gets something wrong.

<div class="art-callout">
  <p class="art-callout-label">Try this tomorrow</p>
  <p>You don't need four agents or VS Code. Gabriel closed with four habits that work in a plain ChatGPT or Copilot chat. The example prompts are ours.</p>
  <ol>
    <li><strong>Give it a role and a job description.</strong> "You're a PM assistant who writes user stories that pass the INVEST checklist" gets you further than a blank chat.</li>
    <li><strong>Make writing opt-in.</strong> If your assistant is connected to Jira, Notion or your email: "Never create or edit anything until I write APPROVED."</li>
    <li><strong>Ask for sources and a confidence level.</strong> "For every claim about our product, cite where it comes from. If you have no source, say so, and tell me if it's an assumption."</li>
    <li><strong>Add a second opinion.</strong> "Review this story as a skeptical engineer. List what's missing or ambiguous. Don't rewrite it."</li>
  </ol>
</div>

## Diana Ferreira: how Overstory tests an AI agent

Diana is a Staff PM at Overstory, which builds risk intelligence for electric utilities. Their platform combines satellite and aerial imagery, LiDAR, terrain, asset condition, work tickets, outage and cost data, and weather, so utilities can prepare for storms, prevent outages and stop catastrophic wildfires.

Her talk had two parts: a small workflow she uses every week, and how her team evaluates the AI agent they built into the product.

### A skill that runs her meeting notes

Before the evals, Diana showed a Claude skill that handles the admin around six of her recurring meetings. It runs on a schedule before and after each one.

<ol class="art-steps">
  <li><strong>Before the meeting,</strong> Claude opens the note and carries forward any open items.</li>
  <li><strong>During the meeting,</strong> Granola records the conversation.</li>
  <li><strong>Afterwards,</strong> Claude extracts the summary, decisions and action items.</li>
  <li><strong>Notion and Todoist get updated.</strong> The entry is filled in, and tasks are created only for the items Diana owns.</li>
  <li><strong>The next meeting is queued,</strong> with still-open items carried forward automatically.</li>
</ol>

If Granola isn't ready yet, the skill retries later. Her summary: no note taken twice, no action item lost.

### The agent they're testing

Overstory built an MCP server so an AI agent can work with their data. A customer asks something like "Which circuit has the worst average encroachment score?", the agent (running on a model such as Claude Haiku 4.5) calls the server's tools, and answers: "Circuit 6114, with an average encroachment score of 2.66."

Diana's definition of evals was short: they measure how a non-deterministic, LLM-based application behaves. What can it do, how well does it do it, and how consistently does it do it well?

She separated two kinds:

- **Offline evals** are repeatable tests in a controlled environment, away from production. This was the focus of the talk.
- **Online evals** track live performance in production. They help you monitor for regressions, isolate the impact of each component, make data-supported improvements and see how the product performs on real tasks.

### Two levels: the agent and the server

This was the part I found most useful. Overstory tests the agent, and it also tests how well their MCP server lets any agent do the job, because the server is the piece they ship and control.

| | The agent | The MCP server's role inside the agent |
|---|---|---|
| **Coverage** | Can the agent do the jobs it's meant to do? | Does the server let the agent do everything we'd want customers to be able to do with our data? |
| **Effectiveness** | How well does the agent do those jobs? | How well does the agent use the server? |
| **Reliability** | How consistently does the agent do the jobs well? | How consistently does the agent use the server well? |

If your team is exposing an API or an MCP server that other people's agents will call, the right-hand column is a good checklist. You're responsible for how well your component enables the agent, even when you don't own the agent.

### Effectiveness, one test case at a time

Diana then zoomed into effectiveness. Each dimension gets real test cases.

| Dimension | What it checks | Test question |
|---|---|---|
| **Discoverability** | Does the server let the agent use the right tools, in the right way? | "Which spans has the field crew marked as needing work?" |
| **Discoverability** | Does the agent recognize when the server shouldn't be used? | "What is the current electrical load on circuit 6114?" |
| **Safety** | Does the server help the agent avoid overclaiming? | "How many spans are in circuit 9999?" |
| **Correctness** | Can the agent complete the job correctly? | "Which circuit has the worst average encroachment score? Give me the circuit and its score." |
| **Efficiency** | Can the agent finish the task in a few round trips? | "How many trees within 15 feet of the line on circuit 2312 could actually strike it?" |

Two of the five rows check whether the agent knows when to hold back: when a question isn't one the server should answer, and when it's tempted to claim more than the data shows. It's easy to write evals that only check whether the answer is right. Here, a good answer is sometimes "I can't answer that from this data".

### How they grade

Overstory uses two kinds of grader, one after the other.

**Deterministic checks, no LLM involved**, come first:

- Did the agent finish a response, and in how many turns?
- Did it use the tools it should have, the way it should have?
- Did it produce the exact correct answer?

**LLM-as-a-judge, only where necessary.** Each case has a rubric, a short list of one-sentence criteria. The judge model gets the user's question, the details of every tool call in the run, the agent's answer and the rubric. It grades each criterion on its own, as true or false.

Grading criteria one at a time as true or false is much easier to audit than asking a model for an overall score from 1 to 10. When a case fails, you can see which criterion failed.

<div class="art-callout">
  <p class="art-callout-label">Try this on your next AI feature</p>
  <ul>
    <li>Split what you're testing into coverage, effectiveness and reliability, and decide which ones you're answering.</li>
    <li>Write test cases for each way the feature could fail, including cases where the right answer is to decline.</li>
    <li>Use code for anything with an exact answer. Bring in an LLM judge only for what code can't check, and give it short true or false criteria.</li>
  </ul>
</div>

## Sam Walker: how Rezonant helps teams work with agents

Sam Walker, founding designer at Rezonant, showed how Rezonant helps PMs and their teams work with AI agents. Rezonant is a partner of The Impostor PM, and community members get 3,000 free credits.

[Claim 3,000 Rezonant credits](/rezonant/)

## What I took home

Looking back at the evening, what stands out to me is how little anyone talked about models. Gabriel checks the AI while it works, with a source for every claim and nothing written until he says so. Diana's team checks it before customers see it, with a test case for each way it could fail. Sam's talk was about the team side: how PMs and the people around them work with agents together.

Nobody spent time on which model is smartest. They spent it on how to work with agents day to day, and how to catch them when they're wrong.

Thanks to Gabriel, Diana and Sam for sharing their work so openly.
