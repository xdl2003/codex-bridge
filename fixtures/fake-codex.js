#!/usr/bin/env node

console.log(JSON.stringify({
  type: "event_msg",
  payload: {
    type: "agent_message",
    message: "fake codex answer"
  }
}));
