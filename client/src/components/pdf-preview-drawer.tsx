import React from 'react';
import { Sheet, SheetContent, SheetTitle } from './ui/sheet';
import { ExternalLink, FileText } from 'lucide-react';

export interface CitationPreviewData {
  fileUrl: string;
  fileName: string;
  pageNumber?: number;
  highlightText?: string;
}

interface PdfPreviewDrawerProps {
  citation: CitationPreviewData | null;
  onClose: () => void;
}

export const PdfPreviewDrawer: React.FC<PdfPreviewDrawerProps> = ({
  citation,
  onClose,
}) => {
  if (!citation) return null;

  // Local backend proxy URL
  const proxyUrl = `/api/pdf-proxy?url=${encodeURIComponent(citation.fileUrl)}`;

  // Page jump parameter for native PDF viewer
  const pdfHash = `#page=${citation.pageNumber || 1}`;
  const iframeSrc = `${proxyUrl}${pdfHash}`;

  return (
    <Sheet open={!!citation} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="w-full sm:max-w-4xl flex flex-col h-full p-0 gap-0">
        {/* Header */}
        <div className="p-4 border-b flex items-center justify-between bg-background">
          <SheetTitle className="text-sm font-semibold truncate flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" />
            <span>{citation.fileName}</span>
            {citation.pageNumber ? (
              <span className="text-xs font-normal text-muted-foreground">
                (Page {citation.pageNumber})
              </span>
            ) : null}
          </SheetTitle>
          <a
            href={citation.fileUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs text-muted-foreground hover:text-foreground flex items-center gap-1 mr-6"
          >
            Download Original <ExternalLink className="h-3 w-3" />
          </a>
        </div>

        {/* Full-Height PDF Viewer */}
        <div className="flex-1 relative bg-muted/20">
          <iframe
            src={iframeSrc}
            className="w-full h-full border-none"
            title={citation.fileName}
          />
        </div>
      </SheetContent>
    </Sheet>
  );
};