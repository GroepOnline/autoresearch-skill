declare module "@mariozechner/pi-coding-agent" {
  export interface ExtensionAPI {
    on(event: string, handler: (event: any, ctx: any) => Promise<any> | any): void;
    registerCommand(name: string, command: {
      description: string;
      getArgumentCompletions?: (prefix: string) => Array<{ value: string; label: string }>;
      handler: (args: string, ctx: any) => Promise<void> | void;
    }): void;
    sendUserMessage(message: string, options?: { deliverAs?: string }): void;
  }
}
