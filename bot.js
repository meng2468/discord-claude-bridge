const { Client, GatewayIntentBits } = require("discord.js");
const { spawn } = require("child_process");

const CLAUDE_PATH = process.env.CLAUDE_PATH || "claude";
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

// session ID per channel
const sessions = new Map();

// split and send a message respecting Discord's 2000 char limit
async function sendChunked(channel, text) {
  for (let i = 0; i < text.length; i += 2000) {
    await channel.send(text.slice(i, i + 2000));
  }
}

function callClaude(prompt, sessionId, channel) {
  return new Promise((resolve, reject) => {
    const args = [
      "-p", "--output-format", "stream-json", "--verbose",
      "--allowedTools", "Bash", "Read", "Edit", "Write", "Glob", "Grep",
      "WebSearch", "WebFetch", "NotebookEdit", "Task",
    ];
    if (sessionId) {
      args.push("--resume", sessionId);
    }

    const proc = spawn(CLAUDE_PATH, args, {
      cwd: process.env.WORK_DIR || process.cwd(),
      env: { ...process.env, CLAUDECODE: undefined },
    });
    proc.stdin.write(prompt);
    proc.stdin.end();

    let buffer = "";
    let resultSessionId = null;
    let finalResult = null;

    proc.stdout.on("data", (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop(); // keep incomplete line in buffer

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line);
          handleEvent(event, channel);
          if (event.type === "result") {
            resultSessionId = event.session_id;
            finalResult = event.result;
          }
        } catch {}
      }
    });

    proc.stderr.on("data", (d) => {
      console.log(`[claude stderr] ${d.toString().trimEnd()}`);
    });

    console.log(`[claude] spawned PID ${proc.pid}`);
    proc.on("close", (code) => {
      console.log(`[claude] PID ${proc.pid} exited with code ${code}`);
      if (code !== 0) {
        return reject(new Error(`claude exited ${code}`));
      }
      resolve({ text: finalResult, sessionId: resultSessionId });
    });
  });
}

async function handleEvent(event, channel) {
  try {
    if (event.type === "assistant" && event.message?.content) {
      for (const block of event.message.content) {
        // tool calls
        if (block.type === "tool_use") {
          const input = typeof block.input === "string"
            ? block.input
            : JSON.stringify(block.input, null, 2);
          const text = `🔧 **${block.name}**\n\`\`\`\n${input.slice(0, 1900)}\n\`\`\``;
          await sendChunked(channel, text);
        }
        // thinking
        if (block.type === "thinking" && block.thinking) {
          const text = `💭 *Thinking...*\n>>> ${block.thinking.slice(0, 1900)}`;
          await sendChunked(channel, text);
        }
      }
    }

    // tool results
    if (event.type === "user" && event.tool_use_result) {
      const stdout = event.tool_use_result.stdout || "";
      const stderr = event.tool_use_result.stderr || "";
      const output = (stdout + (stderr ? `\nstderr: ${stderr}` : "")).trim();
      if (output) {
        const text = `📋 **Result**\n\`\`\`\n${output.slice(0, 1900)}\n\`\`\``;
        await sendChunked(channel, text);
      }
    }
  } catch (err) {
    console.error("[handleEvent]", err.message);
  }
}

client.on("ready", () => {
  console.log(`Logged in as ${client.user.tag}`);
});

client.on("messageCreate", async (msg) => {
  if (msg.author.bot) return;

  console.log(`[msg] #${msg.channel.name} <${msg.author.username}> ${msg.content.slice(0, 100)}`);
  const sessionId = sessions.get(msg.channel.id);
  const typing = setInterval(() => msg.channel.sendTyping(), 5000);
  msg.channel.sendTyping();
  const start = Date.now();

  try {
    const res = await callClaude(msg.content, sessionId, msg.channel);
    console.log(`[done] ${((Date.now() - start) / 1000).toFixed(1)}s, session=${res.sessionId}`);
    sessions.set(msg.channel.id, res.sessionId);

    // send final response
    const text = res.text || "(empty response)";
    await sendChunked(msg.channel, `**Claude:** ${text}`);
  } catch (err) {
    console.error("Error:", err.message);
    await msg.reply({ content: `Error: ${err.message.slice(0, 1900)}`, failIfNotExists: false });
  } finally {
    clearInterval(typing);
  }
});

client.login(process.env.DISCORD_TOKEN);
