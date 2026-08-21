declare module "@earendil-works/pi-coding-agent" {
  export interface ExtensionAPI {
    on(event: string, handler: (event: any, ctx: any) => Promise<any> | any): void;
    registerCommand(
      name: string,
      command: {
        description: string;
        getArgumentCompletions?: (prefix: string) => Array<{ value: string; label: string }>;
        handler: (args: string, ctx: any) => Promise<void> | void;
      }
    ): void;
    registerTool(definition: {
      name: string;
      label?: string;
      description: string;
      promptSnippet?: string;
      promptGuidelines?: string[];
      parameters: unknown;
      execute(
        toolCallId: string,
        params: any,
        signal: AbortSignal | undefined,
        onUpdate:
          | ((partial: {
              content: Array<{ type: "text"; text: string }>;
              details?: unknown;
            }) => void)
          | undefined,
        ctx: any
      ): Promise<{ content: Array<{ type: "text"; text: string }>; details?: unknown }>;
    }): void;
    sendUserMessage(
      message: string | Array<{ type: string; text?: string }>,
      options?: { deliverAs?: string }
    ): void;
    sendMessage(
      message: { customType: string; content: string; display: boolean; details?: unknown },
      options?: { triggerTurn?: boolean; deliverAs?: string }
    ): void;
    appendEntry(customType: string, data?: unknown): void;
    setActiveTools(names: string[]): void;
  }
}
