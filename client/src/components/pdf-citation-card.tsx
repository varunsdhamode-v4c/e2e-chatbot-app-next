import React, { useState, useEffect, useRef } from 'react';
import { parseCitationUrl } from './databricks-message-citation';
import { FileText, ExternalLink, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface PdfCitationCardProps {
  url: string;
  title?: string;
}

// Global promise to ensure PDF.js script is loaded only once from CDN
let pdfjsPromise: Promise<any> | null = null;

const loadPdfJs = (): Promise<any> => {
  if (pdfjsPromise) return pdfjsPromise;

  pdfjsPromise = new Promise((resolve, reject) => {
    if ((window as any).pdfjsLib) {
      resolve((window as any).pdfjsLib);
      return;
    }
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => {
      const pdfjsLib = (window as any).pdfjsLib;
      if (pdfjsLib) {
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
        resolve(pdfjsLib);
      } else {
        reject(new Error('PDF.js failed to initialize'));
      }
    };
    script.onerror = () => reject(new Error('Failed to load PDF.js script'));
    document.head.appendChild(script);
  });

  return pdfjsPromise;
};

export function PdfCitationCard({ url, title }: PdfCitationCardProps) {
  const citationData = parseCitationUrl(url);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [loading, setLoading] = useState(true);
  const [imageError, setImageError] = useState(false);

  const displayName = title || citationData.fileName;
  const proxyUrl = `/api/pdf-proxy?url=${encodeURIComponent(citationData.fileUrl)}`;

  useEffect(() => {
    let isMounted = true;

    const renderPageImage = async () => {
      try {
        setLoading(true);
        const pdfjsLib = await loadPdfJs();
        const targetPageNum = citationData.pageNumber || 1;

        // Fetch PDF binary via proxy and parse page
        const loadingTask = pdfjsLib.getDocument(proxyUrl);
        const pdf = await loadingTask.promise;
        const page = await pdf.getPage(targetPageNum);

        if (!canvasRef.current || !isMounted) return;

        // Scale page to fit ~300px width for high DPI preview
        const unscaledViewport = page.getViewport({ scale: 1 });
        const scale = 300 / unscaledViewport.width;
        const viewport = page.getViewport({ scale });

        const canvas = canvasRef.current;
        const context = canvas.getContext('2d');

        if (!context) return;

        canvas.width = viewport.width;
        canvas.height = viewport.height;

        await page.render({
          canvasContext: context,
          viewport,
        }).promise;

        if (isMounted) {
          setLoading(false);
        }
      } catch (err) {
        console.error('[PdfCitationCard] Canvas thumbnail render error:', err);
        if (isMounted) {
          setImageError(true);
          setLoading(false);
        }
      }
    };

    renderPageImage();

    return () => {
      isMounted = false;
    };
  }, [proxyUrl, citationData.pageNumber]);

  const handleClick = (e: React.MouseEvent) => {
    e.preventDefault();
    window.dispatchEvent(
      new CustomEvent('open-pdf-citation', {
        detail: citationData,
      }),
    );
  };

  return (
    <div
      onClick={handleClick}
      className={cn(
        'group relative flex w-44 shrink-0 cursor-pointer flex-col overflow-hidden rounded-xl border border-border/80 bg-card/90 shadow-xs transition-all duration-200 hover:-translate-y-1 hover:border-primary/60 hover:shadow-md dark:bg-zinc-900/90',
      )}
      title={`Preview ${displayName}`}
    >
      {/* 1st Page Preview Thumbnail Canvas */}
      <div className="relative flex h-44 w-full items-center justify-center overflow-hidden bg-zinc-200/60 p-2.5 dark:bg-zinc-950/80 border-b border-border/60">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-muted/40 backdrop-blur-xs">
            <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
          </div>
        )}

        {!imageError ? (
          <div className="relative flex h-full w-full items-center justify-center overflow-hidden rounded-xs bg-white shadow-md ring-1 ring-black/10 dark:ring-white/10 transition-transform duration-200 group-hover:scale-105">
            <canvas
              ref={canvasRef}
              className="h-full w-full object-contain"
            />
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2 text-muted-foreground transition-colors group-hover:text-primary">
            <FileText className="h-8 w-8 stroke-[1.5]" />
            <span className="text-[10px] font-semibold uppercase tracking-wider">PDF</span>
          </div>
        )}

        {/* PDF Type Badge */}
        <div className="absolute top-2.5 right-2.5 flex items-center gap-1 rounded-md bg-red-600 px-1.5 py-0.5 text-[9px] font-bold text-white shadow-xs">
          <span>PDF</span>
        </div>
      </div>

      {/* Document Information Footer */}
      <div className="flex flex-col justify-between p-2.5">
        <span className="truncate text-xs font-semibold text-foreground transition-colors group-hover:text-primary">
          {displayName}
        </span>
        <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
          <span className="font-medium">
            {citationData.pageNumber ? `Page ${citationData.pageNumber}` : 'Document'}
          </span>
          <ExternalLink className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100 text-primary" />
        </div>
      </div>
    </div>
  );
}