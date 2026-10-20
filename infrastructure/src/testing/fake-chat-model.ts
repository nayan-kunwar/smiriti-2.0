import type { ChatCompletionOptions, ChatMessage, ChatModel } from '@smriti/domain';

export class FakeChatModel implements ChatModel {
  readonly model = 'fake-chat';
  readonly calls: ChatMessage[][] = [];
  private readonly responses: string[];

  constructor(responses: string[]) {
    this.responses = [...responses];
  }

  async complete(messages: ChatMessage[], _options?: ChatCompletionOptions): Promise<string> {
    this.calls.push(messages.map((message) => ({ ...message })));
    const response = this.responses.shift();
    if (response === undefined) {
      throw new Error('FakeChatModel has no scripted response left');
    }
    return response;
  }
}
