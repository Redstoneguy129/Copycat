import { Client, Context, ID } from "@mtkruto/mtkruto";
import { Command } from "@cliffy/command";
import { HelpCommand } from "@cliffy/command/help";
import { Checkbox } from "@cliffy/prompt";
import "jsr:@std/dotenv/load";

async function app() {
  const trackedChats: string[] = [];
  let outputChats: ID[] = [];

  const client = new Client({
    storage: undefined,
    apiId: Number(Deno.env.get("API_ID")! as unknown as number),
    apiHash: Deno.env.get("API_HASH")!,
  });
  await client.start({
    phone: () => prompt("Enter your phone number:")!,
    code: () => prompt("Enter the code you received:")!,
    password: () => prompt("Enter your account's password:")!,
  });
  console.log("Started.");

  let _chats = await client.getChats();
  const chats = _chats.filter((chat) => chat.chat.type !== "private" //@ts-ignore issue with the library
  ).map((chat) => ({
    id: chat.chat.id,
    //@ts-ignore issue with the library
    name: chat.chat["title"],
  }));

  let lowLevelForums: { access_hash: bigint; id: bigint; title: string }[] = [];

  const allForums = await client.invoke({
    _: "messages.getDialogs",
    offset_date: 0,
    offset_id: 0,
    offset_peer: { _: "inputPeerEmpty" },
    limit: 100,
    hash: BigInt(0),
  });
  //@ts-ignore issue with the library
  for (const chat of allForums.chats) {
    if (chat._ === "channel") {
      lowLevelForums.push({
        access_hash: BigInt(chat.access_hash),
        id: BigInt(chat.id),
        title: chat.title,
      });
    }
  }

  async function getTopicTitles(
    access_hash: bigint,
    id: bigint,
    title: string,
  ): Promise<{ chat_id: ID; topics: string[] }> {
    let topics: string[] = [];
    let offset_date = 0;
    let offset_id = 0;
    let offset_topic = 0;
    const limit = 100;
    let hasMore = true;

    while (hasMore) {
      const response = await client.invoke({
        _: "channels.getForumTopics",
        channel: {
          _: "inputChannel",
          channel_id: id,
          access_hash: access_hash,
        },
        offset_date,
        offset_id,
        offset_topic,
        limit,
      });
      if (response.topics.length > 0) {
        //@ts-ignore issue with the library
        topics.push(...response.topics.map((topic) => topic.title));
        // Update pagination parameters
        const lastTopic = response.topics[response.topics.length - 1];
        //@ts-ignore issue with the library
        offset_date = lastTopic.date;
        offset_id = lastTopic.id;
        //@ts-ignore issue with the library
        offset_topic = lastTopic.topic_id;
      } else {
        hasMore = false;
      }
    }
    return {
      //@ts-ignore issue with the library
      chat_id: chats.find((chat) => chat.name === title)?.id,
      topics,
    };
  }

  const specialChats = (await Promise.all(
    lowLevelForums.map(async (
      forum,
    ) => {
      try {
        return (await getTopicTitles(forum.access_hash, forum.id, forum.title));
      } catch (e) {
        return { chat_id: null, topics: [] };
      }
    }),
  )).filter((chat) => chat.chat_id !== null).map((chat) =>
    chat.topics.map((topic) => chat.chat_id + "/" + topic)
  )
    .flat();

  const nonForumChats = chats.filter((chat) =>
    !specialChats.includes(chat.id + "/" + chat.name)
  );

  type trackedID = ID | string | number;

  const trackTheseChats: trackedID[] = await Checkbox.prompt({
    message:
      "Pick the channels you want to track. Use space to select. Arrow keys to navigate. Enter to submit.",
    options: [
      ...nonForumChats.filter((chat) =>
        !specialChats.find((schat) => schat.includes(chat.id.toString()))
      ).map((chat) => ({ name: chat.name, value: chat.id })),
      ...specialChats.map((chat) => ({
        name: chat.split("/")[1],
        value: chat,
      })),
    ],
  });

  trackedChats.push(...trackTheseChats.map((chat) => chat.toString()));

  client.on("message", (ctx: Context) => {
    try {
      if (ctx.from?.id === ctx.me?.id) {
        //@ts-ignore issue with the library
        if ((ctx.msg?.text as string).toLowerCase() === "/copycat") {
          if (ctx.chat) {
            if (!outputChats.includes(ctx.chat?.id)) {
              outputChats.push(ctx.chat?.id);
              client.sendMessage(
                ctx.chat?.id!,
                `Output chat set here`,
              );
            } else {
              outputChats = outputChats.filter((chat) => chat !== ctx.chat?.id);
              client.sendMessage(
                ctx.chat?.id!,
                `Output chat removed`,
              );
            }
          }
        }
      }

      if (!ctx.msg?.out) {
        let id: string;
        if (ctx.msg?.isTopicMessage) {
          //@ts-ignore issue with the library
          const topicName = ctx.msg.replyToMessage?.forumTopicCreated.name;
          id = ctx.chat?.id.toString() + "/" + topicName;
        } else {
          id = ctx.chat?.id.toString() + "";
        }
        if (trackedChats.includes(id) && outputChats.length !== 0) {
          outputChats.forEach(async (outputChat) =>
            await client.forwardMessage(
              ctx.chat?.id!,
              outputChat,
              ctx.msg!.id,
              {
                dropSenderName: true,
              },
            )
          );
        }
      }
    } catch (e) {
      console.error(e);
    }
  });
}

if (import.meta.main) {
  await new Command()
    .name("Copycat")
    .version("0.1.0")
    .description("Telegram auto forwarding userbot")
    .command("start", new Command().action(app))
    .command("help", new HelpCommand().global())
    .parse(Deno.args);
}
