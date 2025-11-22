import type { ChatMessage } from './openrouter'
import { OpenRouterClient } from './openrouter'

type ToolExecutionContext = {
    addMemory: (entry: MemoryEntry) => void
    memory: ReadonlyArray<MemoryEntry>
}

export type ToolResult = {
    name: string
    output: unknown
    message?: string
    memoryEntry?: MemoryEntry
    toolCallId?: string
}

export type Tool = {
    name: string
    description: string
    execute: (args: unknown, context: ToolExecutionContext) => Promise<ToolResult> | ToolResult
}

export type ToolCallRequest = {
    id?: string
    name: string
    arguments: Record<string, unknown>
}

export type MemoryEntry = {
    role: 'system' | 'user' | 'assistant' | 'tool' | 'memory'
    content: string
    timestamp: number
    metadata?: Record<string, unknown>
}

type AgentOptions = {
    name?: string
    systemPrompt: string
    model?: string
    tools?: Tool[]
    maxRecursions?: number
    client?: OpenRouterClient
}

type AgentRunOptions = {
    maxRecursions?: number
    stream?: boolean
}

export type AgentRunResult = {
    content: string
    raw: unknown
}

type OpenRouterToolCall = {
    id: string
    type: 'function'
    function: {
        name: string
        arguments: string
    }
}

export class Agent {
    private readonly systemPrompt: string
    private readonly model?: string
    private readonly client: OpenRouterClient
    private readonly maxRecursions: number
    private readonly toolRegistry = new Map<string, Tool>()
    private readonly history: ChatMessage[] = []
    private readonly memory: MemoryEntry[] = []

    constructor(options: AgentOptions) {
        this.systemPrompt = options.systemPrompt
        this.model = options.model
        this.maxRecursions = options.maxRecursions ?? 3
        this.client = options.client ?? new OpenRouterClient({ model: options.model })

        this.history.push({ role: 'system', content: this.systemPrompt })

        options.tools?.forEach(tool => {
            this.registerTool(tool)
        })
    }

    registerTool(tool: Tool) {
        if (this.toolRegistry.has(tool.name)) {
            throw new Error(`Tool "${tool.name}" is already registered.`)
        }
        this.toolRegistry.set(tool.name, tool)
    }

    getHistory(): ReadonlyArray<ChatMessage> {
        return this.history
    }

    getMemory(): ReadonlyArray<MemoryEntry> {
        return this.memory
    }

    getClient(): OpenRouterClient {
        return this.client
    }

    addMemory(entry: Omit<MemoryEntry, 'timestamp'> & Partial<Pick<MemoryEntry, 'timestamp'>>) {
        const timestamp = entry.timestamp ?? Date.now()
        const { timestamp: _ignored, ...rest } = entry
        this.memory.push({ ...(rest as Omit<MemoryEntry, 'timestamp'>), timestamp })
    }

    async run(userInput: string, options: AgentRunOptions = {}): Promise<AgentRunResult> {
        this.history.push({ role: 'user', content: userInput })
        const maxRecursions = options.maxRecursions ?? this.maxRecursions
        let iterations = 0
        let finalContent = ''
        let lastRaw: unknown

        while (iterations < maxRecursions) {
            /* eslint-disable no-await-in-loop */
            const response: any = await this.client.sendChat(this.history, {
                model: this.model,
                stream: options.stream,
            })
            lastRaw = response

            const assistantMessage = response?.choices?.[0]?.message
            if (!assistantMessage) {
                throw new Error('OpenRouter response missing assistant message.')
            }
            const { content, toolCalls } = this.normalizeAssistantMessage(assistantMessage)
            if (content) {
                this.history.push({ role: 'assistant', content })
                finalContent = content
            }

            if (toolCalls.length === 0) {
                break
            }

            const toolResults = await this.executeToolCalls(toolCalls)
            toolResults.forEach(result => {
                const toolContent =
                    result.message ??
                    (typeof result.output === 'string'
                        ? result.output
                        : JSON.stringify(result.output, null, 2))
                const toolCallId = result.toolCallId ?? this.generateToolCallId(result.name)
                this.history.push({
                    role: 'tool',
                    content: toolContent,
                    name: result.name,
                    toolCallId,
                })
                if (result.memoryEntry) {
                    this.addMemory(result.memoryEntry)
                }
            })

            iterations += 1
        }

        return {
            content: finalContent,
            raw: lastRaw,
        }
    }

    private async executeToolCalls(toolCalls: ToolCallRequest[]) {
        const executions = toolCalls.map(async toolCall => {
            const toolCallId = toolCall.id ?? this.generateToolCallId(toolCall.name)
            const tool = this.toolRegistry.get(toolCall.name)
            if (!tool) {
                return {
                    name: toolCall.name,
                    output: `Tool "${toolCall.name}" not registered`,
                    message: `Tool "${toolCall.name}" not registered`,
                    toolCallId,
                } satisfies ToolResult
            }

            try {
                const output = await tool.execute(toolCall.arguments, {
                    addMemory: entry => this.addMemory(entry),
                    memory: this.memory,
                })
                return {
                    ...output,
                    name: output.name ?? toolCall.name,
                    toolCallId: output.toolCallId ?? toolCallId,
                }
            } catch (error) {
                return {
                    name: toolCall.name,
                    output: error instanceof Error ? error.message : 'Unknown tool error',
                    message: error instanceof Error ? error.message : 'Unknown tool error',
                    toolCallId,
                } satisfies ToolResult
            }
        })

        return Promise.all(executions)
    }

    private generateToolCallId(seed: string) {
        const random = Math.random().toString(36).slice(2, 8)
        return `${seed || 'tool'}_${Date.now().toString(36)}_${random}`
    }

    private normalizeAssistantMessage(message: any): {
        content: string
        toolCalls: ToolCallRequest[]
    } {
        const content = Array.isArray(message.content)
            ? message.content
                  .map((chunk: any) => chunk?.text ?? '')
                  .join('\n')
                  .trim()
            : (message.content ?? '')

        const toolCalls: ToolCallRequest[] =
            (message.tool_calls as OpenRouterToolCall[] | undefined)?.map(toolCall => {
                let parsedArgs: Record<string, unknown> = {}
                try {
                    parsedArgs = toolCall.function.arguments
                        ? JSON.parse(toolCall.function.arguments)
                        : {}
                } catch (error) {
                    parsedArgs = {
                        error: 'Failed to parse tool arguments',
                        raw: toolCall.function.arguments,
                    }
                }
                return {
                    id: toolCall.id,
                    name: toolCall.function.name,
                    arguments: parsedArgs,
                }
            }) ?? []

        return { content, toolCalls }
    }
}
