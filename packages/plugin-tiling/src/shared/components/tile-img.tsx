import { ignore, PdfErrorCode } from '@embedpdf/models';
import { Tile } from '@embedpdf/plugin-tiling';
import { useEffect, useRef, useState } from '@framework';

import { useTilingCapability } from '../hooks/use-tiling';

interface TileImgProps {
  pageIndex: number;
  tile: Tile;
  dpr: number;
  scale: number;
}

export function TileImg({ pageIndex, tile, dpr, scale }: TileImgProps) {
  const { provides: tilingCapability } = useTilingCapability();

  const [url, setUrl] = useState<string>();
  const urlRef = useRef<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bitmapForcedOff =
    typeof globalThis === 'object' && !!(globalThis as Record<string, unknown>).__EMBEDPDF_FORCE_BLOB;
  const supportsBitmap = !bitmapForcedOff && !!tilingCapability?.renderTileBitmap;

  const relativeScale = scale / tile.srcScale;

  /* kick off render exactly once per tile */
  useEffect(() => {
    if (!tilingCapability) return;
    if (supportsBitmap && tilingCapability.renderTileBitmap) {
      const bitmapTask = tilingCapability.renderTileBitmap({ pageIndex, tile, dpr });
      let completed = false;

      bitmapTask.wait((bitmap) => {
        completed = true;
        setUrl(undefined);
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

    const blobTask = tilingCapability.renderTile({ pageIndex, tile, dpr });
    let completed = false;

    blobTask.wait((blob) => {
      const objectUrl = URL.createObjectURL(blob);
      urlRef.current = objectUrl;
      setUrl(objectUrl);
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
  }, [tilingCapability, pageIndex, tile.id, dpr, supportsBitmap]);

  const handleImageLoad = () => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
  };

  if (supportsBitmap) {
    return (
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          left: tile.screenRect.origin.x * relativeScale,
          top: tile.screenRect.origin.y * relativeScale,
          width: tile.screenRect.size.width * relativeScale,
          height: tile.screenRect.size.height * relativeScale,
          display: 'block',
        }}
      />
    );
  }

  if (!url) return null; // could render a placeholder
  return (
    <img
      src={url}
      onLoad={handleImageLoad}
      style={{
        position: 'absolute',
        left: tile.screenRect.origin.x * relativeScale,
        top: tile.screenRect.origin.y * relativeScale,
        width: tile.screenRect.size.width * relativeScale,
        height: tile.screenRect.size.height * relativeScale,
        display: 'block',
      }}
    />
  );
}
