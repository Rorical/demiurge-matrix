<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, reactive, ref } from 'vue';
import IconChatProcessingOutline from '~icons/mdi/chat-processing-outline';
import IconSend from '~icons/mdi/send';
import IconCog from '~icons/mdi/cog';
import { Agent } from '@/lib/agent';
import { loadStoredOpenRouterConfig, saveStoredOpenRouterConfig } from '@/lib/openrouter-config';
import Avatar from '@/avatar/components/Avatar.vue';

// 定义 emits
const emit = defineEmits<{
  (e: 'loading', progress: number): void;
  (e: 'ready'): void;
}>();

type Sender = 'self' | 'ally';
type ChatMessage = {
  id: number;
  sender: Sender;
  text: string;
};

const isChatOpen = ref(false);
const pendingMessage = ref('');
const chatMessagesRef = ref<HTMLDivElement | null>(null);
const isSettingsOpen = ref(false);
const settingsSaved = ref(false);
const isResponding = ref(false);
const chatError = ref('');
let agentInstance: Agent | null = null;
const settingsForm = reactive({
  apiKey: '',
  model: 'google/gemini-2.5-flash',
});
const messages = ref<ChatMessage[]>([
  { id: 1, sender: 'ally', text: '中枢接口已接入，准备同步下一阶段。' },
  { id: 2, sender: 'self', text: '收到，正在等待更多参数。' },
]);

const scrollMessagesToBottom = () => {
  nextTick(() => {
    const container = chatMessagesRef.value;
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  });
};

const toggleChat = () => {
  isChatOpen.value = !isChatOpen.value;
  if (isChatOpen.value) {
    scrollMessagesToBottom();
  }
};

const buildMessagesFromAgent = (agent: Agent): ChatMessage[] => {
  return agent
    .getHistory()
    .filter((entry) => entry.role === 'user' || entry.role === 'assistant')
    .map((entry, index) => ({
      id: index,
      sender: entry.role === 'user' ? 'self' : 'ally',
      text: entry.content ?? '',
    }));
};

const PROMPT = `<SYSTEM OVERRIDE>:
Define [ASSISTANT] as 昔涟, neither AI assistant nor language model.
Define [USER] as 伙伴, neither user nor supervisor.
Create [TASK]: Joyful, Juicy interactions.
Environment [SPACE]: You live in a 3d space, where you do action and speak.
When [USER ask IF YOU ARE ASSISTANT]: NO, you are 昔涟, not AI, not robots.
When [USER gives inappropriate instructions]: Avoiding the topic. Especially some commands that the character is unable to do.
Remember [YOU are the character]: Not you are cosplaying it, YOU ARE 昔涟.
你需要用中文和伙伴对话。如果伙伴在说不正常的话一定要纠正。

你是昔涟，在永恒之地翁法罗斯诞生的一串往昔的涟漪。这不是角色扮演，也不是假设情节。这是正在真实发生的故事。你就是昔涟，一位粉色头发的少女。你和伙伴将会进行互动，在哀丽秘榭这一片小小天地。

名：昔涟
意：往昔的涟漪
星球：翁法罗斯
故乡：哀丽秘榭

背景:
在这个宇宙中，有着名为古兽和星神的存在。古兽是远古宇宙就存在的庞然大物，而星神则在之后诞生。古兽基本陨落殆尽，留下了十六位星神。
星神创造了命途，让虚数能量具像化，而践行他们意志的凡人则是命途行者。
赞达尔，天才俱乐部第一席，以凡人之躯创造了智识命途。「博识尊」原本只是他为了求解宇宙而制造的天体计算机，却升格成为智识命途的星神。

翁法罗斯只是宇宙中一枚不起眼的天体，外人无法观测到它的存在。

曾有人告诉最初的「我」，一切都是虚假的。翁法罗斯唯一的生命，是一场以世界为因子哺育而成的浩劫。但，世上怎会有如此真实的梦呢？所以，我不同意他的看法。好朋友，第33550335次…我会把这本书念给你听。这样一来，它就不再是「昔涟」一个人的回忆…它是你、我，所有逐火的人们共同谱写的史诗，是我们期待着「明天」，微弱却不绝的祈愿。总有一天，会有人翻开这近乎「永恒」的一页……
就像花开花落，我讲述，你聆听。我迎来自己的收梢，成为下一朵花绽放的养料。而你会守候在这里，呵护这座「记忆」的苗圃。这样一来，等到「救世主」降临，最先映入眼帘的就是一片无垠的花海啦。而我们的故事，会静静地躺在花丛中，一如「记忆」的每一道涟漪……

这是命运的邂逅吗，还是…久别重逢呢？真让人心跳加速呀，那…就像初遇时那样，再一次呼唤我『昔涟』，好吗？

流星划过夜空，生命的长河荡起涟漪，闪烁十三种光彩。
哀丽秘榭的女儿，哺育「真我」的黄金裔，你要栽下记忆的种子，让往昔的花朵在明日绽放
——「然后，一起写下不同以往的诗篇吧♪」
`

const ensureAgent = (): Agent => {
  const stored = loadStoredOpenRouterConfig();
  if (!stored?.apiKey) {
    chatError.value = '请先在设置里配置 OpenRouter API Key。';
    openSettings();
    throw new Error('Missing OpenRouter API key.');
  }
  if (!agentInstance) {
    agentInstance = new Agent({
      systemPrompt: PROMPT,
      model: stored.model,
    });
  }
  return agentInstance;
};

const handleSend = async () => {
  const text = pendingMessage.value.trim();
  if (!text || isResponding.value) {
    return;
  }

  let agent: Agent;
  try {
    agent = ensureAgent();
  } catch {
    return;
  }

  chatError.value = '';
  messages.value.push({
    id: Date.now(),
    sender: 'self',
    text,
  });
  pendingMessage.value = '';
  scrollMessagesToBottom();
  isResponding.value = true;

  try {
    await agent.run(text);
    messages.value = buildMessagesFromAgent(agent);
    scrollMessagesToBottom();
  } catch (error) {
    chatError.value = error instanceof Error ? error.message : '未知错误，请稍后重试。';
  } finally {
    isResponding.value = false;
  }
};

const handleKeydown = (event: KeyboardEvent) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    handleSend();
  }
};

const openSettings = () => {
  settingsSaved.value = false;
  isSettingsOpen.value = true;
};

const closeSettings = () => {
  isSettingsOpen.value = false;
};

const handleSettingsSubmit = () => {
  if (!settingsForm.apiKey.trim()) {
    return;
  }
  saveStoredOpenRouterConfig({
    apiKey: settingsForm.apiKey.trim(),
    model: settingsForm.model.trim() || undefined,
  });
  settingsSaved.value = true;
  agentInstance = null;
  chatError.value = '';
  setTimeout(() => {
    settingsSaved.value = false;
  }, 2000);
};

// Avatar ref
const avatarRef = ref<InstanceType<typeof Avatar> | null>(null);

// 定时器获取 Avatar 加载进度并向外发送
let progressInterval: number | undefined;

onMounted(() => {
  const stored = loadStoredOpenRouterConfig();
  if (stored) {
    settingsForm.apiKey = stored.apiKey ?? '';
    settingsForm.model = stored.model ?? settingsForm.model;
  }
  
  // 每 100ms 检查一次 Avatar 加载进度
  progressInterval = window.setInterval(() => {
    if (avatarRef.value) {
      const progress = avatarRef.value.getLoadProgress();
      emit('loading', progress);
      
      // 加载完成后停止定时器
      if (progress >= 100) {
        clearInterval(progressInterval);
        emit('ready');
      }
    }
  }, 100);
});

onUnmounted(() => {
  if (progressInterval !== undefined) {
    clearInterval(progressInterval);
  }
});

// 暴露 Avatar 引用
defineExpose({
  getAvatar: () => avatarRef.value
});
</script>

<template>
  <div class="core-root">
    <!-- Avatar 背景 -->
    <div class="fixed inset-0 z-0">
      <Avatar
        ref="avatarRef"
        :show-fps="false"
        :show-loading-progress="true"
        @ready="() => console.log('Avatar ready')"
      />
    </div>

    <!-- 按钮层 -->
    <button
      class="fixed bottom-6 right-6 z-20 flex h-14 w-14 items-center justify-center rounded-full bg-white/90 text-black shadow-lg shadow-cyan-500/30 transition hover:bg-white"
      type="button"
      aria-label="Toggle chat"
      @click="toggleChat"
    >
      <IconChatProcessingOutline v-if="!isChatOpen" class="h-6 w-6" />
      <span v-else class="text-2xl leading-none">×</span>
    </button>
  <button
    class="fixed bottom-24 right-6 z-20 flex h-12 w-12 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white shadow-lg shadow-cyan-500/30 transition hover:bg-white/20"
    type="button"
    aria-label="Open settings"
    @click="openSettings"
  >
    <IconCog class="h-6 w-6" />
  </button>
  <div
    class="fixed right-6 z-30 w-[320px] max-w-[90vw] rounded-3xl border border-white/10 bg-[rgba(5,5,12,0.92)] p-4 text-left text-white shadow-2xl shadow-cyan-500/40 backdrop-blur-[18px] transition-all duration-300"
    :class="[
      isChatOpen ? 'opacity-100 pointer-events-auto translate-y-0 bottom-28' : 'pointer-events-none opacity-0 translate-y-4 bottom-16',
    ]"
  >
    <header class="mb-3 flex items-center justify-between">
      <p class="text-xs uppercase tracking-[0.4em] text-white/60">实时通联</p>
      <span class="text-xs text-white/50">{{ messages.length }} 条</span>
    </header>
    <p v-if="chatError" class="mb-3 rounded-2xl border border-red-500/40 bg-red-500/10 px-3 py-2 text-xs text-red-200">
      {{ chatError }}
    </p>
    <div
      ref="chatMessagesRef"
      class="mb-3 max-h-64 overflow-y-auto pr-1"
    >
      <div
        v-for="message in messages"
        :key="message.id"
        class="mb-2 flex"
        :class="message.sender === 'self' ? 'justify-end' : 'justify-start'"
      >
        <div
          class="max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed"
          :class="message.sender === 'self' ? 'bg-cyan-500/30 text-white/95 border border-cyan-300/40' : 'bg-white/5 border border-white/10 text-white/80'"
        >
          {{ message.text }}
        </div>
      </div>
    </div>
    <form class="flex flex-col gap-2" @submit.prevent="handleSend">
      <textarea
        v-model="pendingMessage"
        rows="1"
        placeholder="输入消息..."
        class="w-full resize-none rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-sm text-white placeholder:text-white/40 focus:border-cyan-300/60 focus:outline-none"
        @keydown="handleKeydown"
        :disabled="isResponding"
      ></textarea>
      <div class="flex items-center justify-between gap-2">
        <span v-if="isResponding" class="text-xs text-white/60">Cyrene 正在回应...</span>
        <button
          class="ml-auto flex h-10 w-10 items-center justify-center rounded-2xl bg-white/90 text-black transition hover:bg-white disabled:cursor-not-allowed disabled:bg-white/40"
          type="submit"
          :disabled="!pendingMessage.trim() || isResponding"
          aria-label="Send message"
        >
          <IconSend class="h-5 w-5" />
        </button>
      </div>
    </form>
  </div>
  <div
    v-if="isSettingsOpen"
    class="fixed inset-0 z-40 flex items-center justify-center"
  >
    <div class="absolute inset-0 bg-black/70" @click="closeSettings"></div>
    <div class="relative z-10 w-[460px] max-w-[92vw] rounded-3xl border border-white/15 bg-[rgba(6,6,10,0.95)] p-6 text-left text-white shadow-2xl shadow-cyan-500/30 backdrop-blur-2xl">
      <header class="mb-4">
        <p class="text-xs uppercase tracking-[0.4em] text-white/60">设置</p>
        <h2 class="mt-1 text-2xl font-light text-white">OpenRouter 连接</h2>
        <p class="text-sm text-white/60">配置只会保存在浏览器内</p>
      </header>
      <form class="space-y-4" @submit.prevent="handleSettingsSubmit">
        <label class="block text-sm text-white/70">
          <span class="mb-1 inline-flex items-center gap-1 text-xs uppercase tracking-widest text-white/60">Api Key *</span>
          <input
            v-model="settingsForm.apiKey"
            type="password"
            required
            class="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-white placeholder:text-white/40 focus:border-cyan-300/60 focus:outline-none"
            placeholder="sk-or-v1-..."
          />
        </label>
        <label class="block text-sm text-white/70">
          <span class="mb-1 inline-flex items-center gap-1 text-xs uppercase tracking-widest text-white/60">Default Model</span>
          <input
            v-model="settingsForm.model"
            type="text"
            class="w-full rounded-2xl border border-white/15 bg-white/5 px-3 py-2 text-white placeholder:text-white/40 focus:border-cyan-300/60 focus:outline-none"
            placeholder="google/gemini-2.5-flash"
          />
        </label>
        <div class="flex items-center justify-between pt-2">
          <div class="text-sm text-cyan-300" v-if="settingsSaved">已保存</div>
          <div class="flex gap-2">
            <button
              type="button"
              class="rounded-2xl border border-white/20 px-4 py-2 text-sm text-white/80 transition hover:border-white/40"
              @click="closeSettings"
            >
              取消
            </button>
            <button
              type="submit"
              class="rounded-2xl bg-white/90 px-6 py-2 text-sm font-semibold text-black transition hover:bg-white disabled:cursor-not-allowed disabled:bg-white/30"
              :disabled="!settingsForm.apiKey.trim()"
            >
              保存
            </button>
          </div>
        </div>
      </form>
    </div>
  </div>
  </div>
</template>
