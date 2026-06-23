export function createSSEStream(
  reader: ReadableStreamDefaultReader,
  onText?: (text: string) => void,
): ReadableStream {
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      try {
        let text = '';
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          const chunk: any = value;

          switch (chunk.type) {
            case 'text-delta':
              text += chunk.payload?.text ?? '';
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ content: chunk.payload?.text })}\n\n`),
              );
              break;
            case 'text-end':
              break;
            case 'reasoning-delta':
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: 'thinking', content: chunk.payload?.text ?? '' })}\n\n`,
                ),
              );
              break;
            case 'reasoning-end':
              controller.enqueue(
                encoder.encode(`data: ${JSON.stringify({ type: 'thinking_done' })}\n\n`),
              );
              break;
            case 'tool-call':
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'tool_status',
                    toolType: 'call',
                    message: `Calling ${chunk.payload?.toolName}`,
                    detail: { name: chunk.payload?.toolName, args: chunk.payload?.args },
                  })}\n\n`,
                ),
              );
              break;
            case 'tool-result':
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'tool_status',
                    toolType: 'result',
                    message: `Done ${chunk.payload?.toolName}`,
                    detail: { name: chunk.payload?.toolName, result: chunk.payload?.result },
                  })}\n\n`,
                ),
              );
              break;
            case 'finish':
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({
                    type: 'done',
                    usage: chunk.payload?.output?.usage,
                  })}\n\n`,
                ),
              );
              break;
            case 'error':
              controller.enqueue(
                encoder.encode(
                  `data: ${JSON.stringify({ type: 'error', message: String(chunk.payload?.error ?? '') })}\n\n`,
                ),
              );
              controller.close();
              return;
          }
        }
        controller.enqueue(encoder.encode('data: [DONE]\n\n'));
        controller.close();
        if (onText) onText(text);
      } catch (err) {
        controller.enqueue(
          encoder.encode(`data: ${JSON.stringify({ type: 'error', message: String(err) })}\n\n`),
        );
        controller.close();
      }
    },
  });
}
