import type { ChatMessage } from '@chat-template/core';
import type {
  AnchorHTMLAttributes,
  ComponentType,
  MouseEvent,
  PropsWithChildren,
} from 'react';
import { Tooltip, TooltipContent, TooltipTrigger } from './ui/tooltip';
import { cn } from '@/lib/utils';
import type { CitationPreviewData } from './pdf-preview-drawer';

/**
 * Parses Databricks volume / SharePoint citation links to extract:
 * Clean base file URL (stripping hash)
 * File display name
 * Target page number from #page=X
 * Target text snippet from :~:text=...
 */
export function parseCitationUrl(fullUrl: string): CitationPreviewData {
  try {
    // Sanitize any spaces inside the URL before constructing URL object
    const normalizedUrl = fullUrl.replace(/ /g, '%20');
    const url = new URL(normalizedUrl);
    const hash = url.hash;

    // Remove hash from download URL to fetch raw PDF binary
    url.hash = '';
    const fileUrl = url.toString();

    const pathnameParts = url.pathname.split('/');
    const rawFileName = pathnameParts[pathnameParts.length - 1] || 'Document.pdf';
    const fileName = decodeURIComponent(rawFileName);

    let pageNumber: number | undefined;
    let highlightText: string | undefined;

    if (hash) {
      const pageMatch = hash.match(/page=(\d+)/);
      if (pageMatch) {
        pageNumber = parseInt(pageMatch[1], 10);
      }

      const textMatch = hash.match(/:~:text=(.+)/);
      if (textMatch) {
        let rawText = textMatch[1];
        // Handle custom Databricks / Agent Bricks encoding markers
        rawText = rawText.replace(/%@A/g, ' ').replace(/%2@/g, ' ');
        try {
          highlightText = decodeURIComponent(rawText);
        } catch {
          highlightText = rawText;
        }
      }
    }

    return { fileUrl, fileName, pageNumber, highlightText };
  } catch {
    return {
      fileUrl: fullUrl,
      fileName: 'Document.pdf',
    };
  }
}

/**
 * ReactMarkdown/Streamdown component that handles Databricks message citations.
 *
 * @example
 * <Streamdown components={{ a: DatabricksMessageCitationStreamdownIntegration }} />
 */
export const DatabricksMessageCitationStreamdownIntegration: ComponentType<
  AnchorHTMLAttributes<HTMLAnchorElement>
> = (props) => {
  if (isDatabricksMessageCitationLink(props.href)) {
    return (
      <DatabricksMessageCitationRenderer
        {...props}
        href={decodeDatabricksMessageCitationLink(props.href)}
      />
    );
  }
  return <DefaultAnchor {...props} />;
};

type SourcePart = Extract<ChatMessage['parts'][number], { type: 'source-url' }>;

// Adds a unique suffix to the link to indicate that it is a Databricks message citation.
const encodeDatabricksMessageCitationLink = (part: SourcePart) =>
  `${part.url}::databricks_citation`;

// Removes the unique suffix from the link to get the original link.
const decodeDatabricksMessageCitationLink = (link: string) =>
  link.replace('::databricks_citation', '');

// Creates a markdown link to the Databricks message citation.
export const createDatabricksMessageCitationMarkdown = (part: SourcePart) =>
  `[${part.title || part.url}](${encodeDatabricksMessageCitationLink(part)})`;

// Checks if the link is a Databricks message citation.
const isDatabricksMessageCitationLink = (
  link?: string,
): link is `${string}::databricks_citation` =>
  link?.endsWith('::databricks_citation') ?? false;

// Renders the Databricks message citation with in-app preview click interceptor.
const DatabricksMessageCitationRenderer = (
  props: PropsWithChildren<{
    href: string;
  }>,
) => {
  const citationData = parseCitationUrl(props.href);

  const handleClick = (e: MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    window.dispatchEvent(
      new CustomEvent('open-pdf-citation', {
        detail: citationData,
      }),
    );
  };

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <a
          href={props.href}
          onClick={handleClick}
          className="wrap-anywhere font-medium text-primary underline cursor-pointer"
        >
          {props.children}
        </a>
      </TooltipTrigger>
      <TooltipContent
        style={{ maxWidth: '300px', padding: '8px', wordWrap: 'break-word' }}
      >
        Preview {citationData.fileName}
        {citationData.pageNumber ? ` (Page ${citationData.pageNumber})` : ''}
      </TooltipContent>
    </Tooltip>
  );
};

// Default Anchor fallback
const DefaultAnchor: ComponentType<AnchorHTMLAttributes<HTMLAnchorElement>> = (
  props,
) => {
  const isIncomplete = props.href === 'streamdown:incomplete-link';
  const isFootnoteLink = props.href?.startsWith('#');

  return (
    <a
      className={cn(
        'wrap-anywhere font-medium text-primary underline',
        props.className,
      )}
      data-incomplete={isIncomplete}
      data-streamdown="link"
      href={props.href}
      {...props}
      {...(isFootnoteLink
        ? {
            target: '_self',
          }
        : {
            target: '_blank',
            rel: 'noopener noreferrer',
          })}
    >
      {props.children}
    </a>
  );
};