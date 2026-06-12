import Parser from 'rss-parser';
import nodemailer from 'nodemailer';

export function createCommunicationCapabilities() {
  const rssParser = new Parser();
  return {
    fetchRss: async (url: string, limit?: number) => {
      const feed = await rssParser.parseURL(url);
      return {
        entries: (feed.items ?? [])
          .slice(0, limit ?? 20)
          .map(
            (item: {
              title?: string;
              link?: string;
              pubDate?: string;
              contentSnippet?: string;
              creator?: string;
              isoDate?: string;
              content?: string;
            }) => ({
              title: item.title ?? '',
              link: item.link ?? '',
              pubDate: item.pubDate ?? item.isoDate,
              content: item.content ?? item.contentSnippet ?? '',
            }),
          ),
      };
    },
    sendEmail: async (to: string, subject: string, body: string, bodyType?: 'text' | 'html') => {
      // SMTP config is read from environment or settings at runtime
      const smtpConfig = process.env.SMTP_CONFIG ? JSON.parse(process.env.SMTP_CONFIG) : null;
      if (!smtpConfig) {
        throw new Error('SMTP not configured. Set SMTP_CONFIG env var with JSON transport config.');
      }
      const transporter = nodemailer.createTransport(smtpConfig);
      const result = await transporter.sendMail({
        from: smtpConfig.from,
        to,
        subject,
        [bodyType === 'html' ? 'html' : 'text']: body,
      });
      return { sent: true, messageId: result.messageId };
    },
  };
}
