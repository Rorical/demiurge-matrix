import { OpenRouter } from '@openrouter/sdk'
import { loadStoredOpenRouterConfig, type StoredOpenRouterConfig } from './openrouter-config'

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool'

export type ChatMessage = {
    role: ChatRole
    content: string
    name?: string
    toolCallId?: string
}

type OpenRouterMessage = {
    role: 'system' | 'user' | 'assistant' | 'tool'
    content?: string
    name?: string
    toolCallId?: string
}

type OpenRouterClientOptions = {
    apiKey?: string
    model?: string
    headers?: Record<string, string>
    storedConfig?: StoredOpenRouterConfig | null
}

export class OpenRouterClient {
    private client: OpenRouter
    private model: string
    private readonly defaultHeaders: Record<string, string>

    constructor(options: OpenRouterClientOptions = {}) {
        const storedConfig = options.storedConfig ?? loadStoredOpenRouterConfig()
        const apiKey = options.apiKey ?? storedConfig?.apiKey
        if (!apiKey) {
            throw new Error(
                'OpenRouter API key is missing. Save it in settings or pass apiKey to OpenRouterClient.'
            )
        }

        this.client = new OpenRouter({
            apiKey,
        })
        this.model = options.model ?? storedConfig?.model ?? 'openai/gpt-4o'
        this.defaultHeaders = {
            'X-Title': 'DEMIURGE-MATRIX',
            ...options.headers,
        }
    }

    async sendChat(
        messages: ChatMessage[],
        options?: {
            model?: string
            stream?: boolean
            headers?: Record<string, string>
        }
    ): Promise<any> {
        const headers = { ...this.defaultHeaders, ...options?.headers }
        return this.client.chat.send(
            {
                model: options?.model ?? this.model,
                messages: this.toOpenRouterMessages(messages) as any,
                stream: options?.stream ?? false,
            },
            { headers }
        )
    }

    private toOpenRouterMessages(messages: ChatMessage[]): OpenRouterMessage[] {
        return messages.map(message => {
            switch (message.role) {
                case 'system':
                    return { role: 'system', content: message.content }
                case 'user':
                    return { role: 'user', content: message.content, name: message.name }
                case 'assistant':
                    return { role: 'assistant', content: message.content, name: message.name }
                case 'tool': {
                    if (!message.toolCallId) {
                        throw new Error(
                            'Tool messages require a toolCallId for OpenRouter compatibility.'
                        )
                    }
                    return {
                        role: 'tool',
                        content: message.content,
                        toolCallId: message.toolCallId,
                    }
                }
                default:
                    return { role: 'system', content: message.content }
            }
        })
    }
}
