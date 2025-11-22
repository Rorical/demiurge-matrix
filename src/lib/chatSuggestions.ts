import type { ChatMessage } from './openrouter'
import { OpenRouterClient } from './openrouter'

export type SuggestionMessage = {
    role: 'user' | 'assistant'
    content: string
}

type SuggestionOptions = {
    apiKey?: string
    model?: string
    client?: OpenRouterClient
}

const buildHistoryText = (history: SuggestionMessage[]): string => {
    const recent = history.slice(-8)
    if (!recent.length) return '（尚无对话）'
    return recent
        .map(msg => `${msg.role === 'user' ? '伙伴' : '昔涟'}：${msg.content}`)
        .join('\n')
}

const buildPrompt = (history: SuggestionMessage[]): ChatMessage[] => {
    const formattedHistory = buildHistoryText(history)
    const system = `你是对话引导助手，帮助伙伴与昔涟继续交流。生成 3 条高度多样、简短（<=25 字）的下一步「用户」发言建议，中文输出。避免重复词和语气，覆盖不同角度：提问、分享感受、请求互动。务必用 JSON 数组纯文本返回，不要添加任何说明或前后缀。`
    const user = `以下是最近的对话：\n${formattedHistory}\n\n请直接返回 JSON 数组，例如 ["..."]，仅此而已。`
    return [
        { role: 'system', content: system },
        { role: 'user', content: user },
    ]
}

const extractArray = (text: string): string[] => {
    const match = text.match(/\[[\s\S]*\]/)
    if (!match) return []
    try {
        const parsed = JSON.parse(match[0] ?? '[]')
        return Array.isArray(parsed) ? parsed.map(item => String(item)) : []
    } catch (error) {
        return []
    }
}

export const generateChatSuggestions = async (
    history: SuggestionMessage[],
    options: SuggestionOptions = {}
): Promise<string[]> => {
    try {
        const client = options.client ?? new OpenRouterClient({ apiKey: options.apiKey, model: options.model })
        const response = await client.sendChat(buildPrompt(history), {
            model: options.model,
        })
        const content = response?.choices?.[0]?.message?.content ?? ''
        const parsed = extractArray(content)
        return parsed.filter(Boolean).slice(0, 3)
    } catch (error) {
        console.warn('Failed to generate suggestions via LLM:', error)
        return []
    }
}
