import { Fragment, useEffect, useRef, useState } from '@framework';
import type { CSSProperties, HTMLAttributes } from '@framework';

import { ignore, PdfErrorCode } from '@embedpdf/models';

import { useRenderCapability, useRenderPlugin } from '../hooks/use-render';

type RenderLayerProps = Omit<HTMLAttributes<HTMLImageElement>, 'style'> & {
  pageIndex: number;
  /**
   * The scale factor for rendering the page.
   */
  scale?: number;
  /**
   * @deprecated Use `scale` instead. Will be removed in the next major release.
   */
  scaleFactor?: number;
  dpr?: number;
  style?: CSSProperties;
};

export function RenderLayer({
  pageIndex,
  scale,
  scaleFactor,
  dpr,
  style,
  ...props
}: RenderLayerProps) {
  const { provides: renderProvides } = useRenderCapability();
  const { plugin: renderPlugin } = useRenderPlugin();

  // Handle deprecation: prefer scale over scaleFactor, but fall back to scaleFactor if scale is not provided
  const actualScale = scale ?? scaleFactor ?? 1;

  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const urlRef = useRef<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [refreshTick, setRefreshTick] = useState(0);
  const { className, ...restProps } = props;
  const canvasAttributes = restProps as unknown as Record<string, unknown>;
  const bitmapForcedOff =
    typeof globalThis === 'object' && !!(globalThis as Record<string, unknown>).__EMBEDPDF_FORCE_BLOB;
  const supportsBitmap =
    !bitmapForcedOff && typeof renderProvides?.renderPageBitmap === 'function' && !!renderProvides;

  useEffect(() => {
    if (!renderPlugin) return;
    return renderPlugin.onRefreshPages((pages) => {
      if (pages.includes(pageIndex)) {
        setRefreshTick((tick) => tick + 1);
      }
    });
  }, [renderPlugin]);

  useEffect(() => {
    if (!renderProvides) return;

    if (supportsBitmap && renderProvides.renderPageBitmap) {
      const bitmapTask = renderProvides.renderPageBitmap({
        pageIndex,
        options: { scaleFactor: actualScale, dpr: dpr || window.devicePixelRatio },
      });

      let completed = false;

      bitmapTask.wait((bitmap) => {
        completed = true;
        setImageUrl(null);
        if (urlRef.current) {
          URL.revokeObjectURL(urlRef.current);
          urlRef.current = null;
        }
        const canvas = canvasRef.current;
        if (!canvas) {
          if (typeof bitmap.close === 'function') bitmap.close();
          return;
        }
        canvas.width = bitmap.width;
        canvas.height = bitmap.height;
        const bitmapCtx = canvas.getContext('bitmaprenderer') as ImageBitmapRenderingContext | null;
        if (bitmapCtx) {
          bitmapCtx.transferFromImageBitmap(bitmap);
        } else {
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            ctx.drawImage(bitmap, 0, 0);
          }
          if (typeof bitmap.close === 'function') bitmap.close();
        }
      }, ignore);

      return () => {
        if (!completed) {
          bitmapTask.abort({
            code: PdfErrorCode.Cancelled,
            message: 'canceled render task',
          });
        }
      };
    }

    const blobTask = renderProvides.renderPage({
      pageIndex,
      options: { scaleFactor: actualScale, dpr: dpr || window.devicePixelRatio },
    });

    let completed = false;

    blobTask.wait((blob) => {
      const url = URL.createObjectURL(blob);
      setImageUrl(url);
      urlRef.current = url;
      completed = true;
    }, ignore);

    return () => {
      if (urlRef.current) {
        URL.revokeObjectURL(urlRef.current);
        urlRef.current = null;
      } else if (!completed) {
        blobTask.abort({
          code: PdfErrorCode.Cancelled,
          message: 'canceled render task',
        });
      }
    };
  }, [pageIndex, actualScale, dpr, renderProvides, refreshTick, supportsBitmap]);

  const handleImageLoad = () => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  };

  return (
    <Fragment>
      {supportsBitmap ? (
        <canvas
          ref={canvasRef}
          className={className}
          {...(canvasAttributes as any)}
          style={{
            width: '100%',
            height: '100%',
            ...(style || {}),
          }}
        />
      ) : (
        imageUrl && (
          <img
            src={imageUrl}
            onLoad={handleImageLoad}
            {...restProps}
            className={className}
            style={{
              width: '100%',
              height: '100%',
              ...(style || {}),
            }}
          />
        )
      )}
    </Fragment>
  );
}
