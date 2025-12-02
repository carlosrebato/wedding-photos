/* eslint-disable @next/next/no-img-element */
'use client';

import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { supabase } from '@/app/lib/supabase';
import Image from 'next/image';
import Lottie from 'lottie-react';
import uploadArrowAnimation from '@/public/animations/upload-arrow.json';
import checkSuccessAnimation from '@/public/animations/check-success.json';
import imageCompression from 'browser-image-compression';

// ===================== Interfaces =====================
interface PhotoData {
  id: number;
  photo_url: string;
  video_url?: string;
  guest_name: string | null;
  media_type: 'image' | 'video';
  duration?: number;
  upload_batch?: string | null;
}

interface PhotoSegment {
  batchId: string;
  guestName: string;
  items: PhotoData[];
}

// ===================== Helpers =====================
function setCookie(name: string, value: string, days: number) {
  const expires = new Date();
  expires.setTime(expires.getTime() + days * 24 * 60 * 60 * 1000);
  document.cookie = `${name}=${value};expires=${expires.toUTCString()};path=/`;
}

function getCookie(name: string): string | null {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop()?.split(';').shift() || null;
  return null;
}

function createPlaceholder(): Blob {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 400;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(0, 0, 400, 400);
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 100px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('▶', 200, 200);
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  const byteString = atob(dataUrl.split(',')[1]);
  const mimeString = dataUrl.split(',')[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
  return new Blob([ab], { type: mimeString });
}

async function getVideoDuration(file: File): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.src = URL.createObjectURL(file);
    video.onloadedmetadata = () => {
      URL.revokeObjectURL(video.src);
      resolve(Math.round(video.duration));
    };
    video.onerror = () => {
      URL.revokeObjectURL(video.src);
      reject(new Error('Error obteniendo duración'));
    };
  });
}

// ===================== Upload File =====================
async function uploadFile(
  file: File,
  guestName: string | null,
  onError: (msg: string) => void,
  uploadBatchId: string
): Promise<{ url: string; mediaType: 'image' | 'video'; videoUrl?: string; duration?: number } | null> {
  try {
    const isVideo = file.type.startsWith('video/');

    if (isVideo) {
      const sizeMB = file.size / 1024 / 1024;
      if (sizeMB > 200) {
        onError('Video muy grande. Máximo 200MB.');
        return null;
      }
      if (sizeMB > 100) {
        const confirmed = confirm(`⚠️ Este video pesa ${sizeMB.toFixed(0)}MB. ¿Continuar?`);
        if (!confirmed) return null;
      }

      let duration = 0;
      try {
        duration = await getVideoDuration(file);
      } catch {}

      const thumbnailBlob = createPlaceholder();
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(7);
      const thumbFileName = `thumb_video_${timestamp}-${randomId}.jpg`;

      const { error: thumbError } = await supabase.storage.from('wedding-photos').upload(thumbFileName, thumbnailBlob);
      if (thumbError) {
        onError('Error subiendo thumbnail del video.');
        return null;
      }
      const { data: { publicUrl: thumbnailUrl } } = supabase.storage.from('wedding-photos').getPublicUrl(thumbFileName);

      const videoFileName = `video_${timestamp}-${randomId}.${file.name.split('.').pop()}`;
      const { error: videoError } = await supabase.storage.from('wedding-videos').upload(videoFileName, file);
      if (videoError) {
        onError('Error subiendo video.');
        return null;
      }
      const { data: { publicUrl: videoUrl } } = supabase.storage.from('wedding-videos').getPublicUrl(videoFileName);

      const { error: dbError } = await supabase.from('uploads').insert({
        photo_url: thumbnailUrl,
        video_url: videoUrl,
        guest_name: guestName,
        media_type: 'video',
        duration,
        upload_batch: uploadBatchId,
      });
      if (dbError) return null;

      return { url: thumbnailUrl, mediaType: 'video', videoUrl, duration };
    }

    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(7);
    const baseFileName = `${timestamp}-${randomId}`;

    const originalFileName = `original_${baseFileName}.jpg`;
    const { error: originalError } = await supabase.storage.from('wedding-photos').upload(originalFileName, file);
    if (originalError) return null;

    const webFile = await imageCompression(file, { maxSizeMB: 0.5, maxWidthOrHeight: 1920, fileType: 'image/jpeg' });
    const webFileName = `web_${baseFileName}.jpg`;
    const { error: webError } = await supabase.storage.from('wedding-photos').upload(webFileName, webFile);
    if (webError) return null;

    const thumbFile = await imageCompression(file, { maxSizeMB: 0.05, maxWidthOrHeight: 400, fileType: 'image/jpeg' });
    const thumbFileName = `thumb_${baseFileName}.jpg`;
    const { error: thumbError } = await supabase.storage.from('wedding-photos').upload(thumbFileName, thumbFile);
    if (thumbError) return null;

    const { data: { publicUrl } } = supabase.storage.from('wedding-photos').getPublicUrl(thumbFileName);

    const { error: dbError } = await supabase.from('uploads').insert({
      photo_url: publicUrl,
      video_url: null,
      guest_name: guestName,
      media_type: 'image',
      upload_batch: uploadBatchId,
    });
    if (dbError) return null;

    return { url: publicUrl, mediaType: 'image' };
  } catch {
    return null;
  }
}

// ===================== Loaders =====================
async function loadInitialPhotos(limit = 60): Promise<PhotoData[]> {
  const { data } = await supabase.from('uploads').select('id, photo_url, video_url, guest_name, media_type, duration, upload_batch').order('id', { ascending: false }).limit(limit);
  return data || [];
}

async function loadMorePhotos(lastId: number, limit = 20): Promise<PhotoData[]> {
  const { data } = await supabase.from('uploads').select('id, photo_url, video_url, guest_name, media_type, duration, upload_batch').order('id', { ascending: false }).lt('id', lastId).limit(limit);
  return data || [];
}

function getWebUrl(thumbUrl: string): string {
  return thumbUrl.replace('thumb_', 'web_');
}

// ===================== Components =====================
function GallerySkeleton({ count = 8 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="aspect-square relative overflow-hidden rounded-lg bg-gray-200 animate-pulse"
          style={{ minHeight: '200px' }}
        />
      ))}
    </>
  );
}

function ImageWithLoader({ src, alt }: { src: string; alt: string }) {
  const [isLoading, setIsLoading] = useState(true);
  const [hasError, setHasError] = useState(false);

  return (
    <div className="relative w-full max-w-4xl max-h-[70vh] flex items-center justify-center">
      {isLoading && !hasError && (
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="w-12 h-12 border-4 border-white border-t-transparent rounded-full animate-spin"></div>
        </div>
      )}

      {hasError && (
        <div className="text-white text-center">
          <p className="text-xl mb-2">⚠️ Error al cargar la imagen</p>
          <p className="text-sm text-gray-400">Intenta refrescar la página</p>
        </div>
      )}

      <img
        src={src}
        alt={alt}
        className={`max-w-full max-h-[70vh] object-contain rounded-lg transition-opacity duration-300 ${
          isLoading ? 'opacity-0' : 'opacity-100'
        }`}
        onLoad={() => setIsLoading(false)}
        onError={() => {
          setIsLoading(false);
          setHasError(true);
        }}
      />
    </div>
  );
}

function VideoInGallery({
  videoUrl,
  thumbnailUrl,
  index,
  likes,
  onClick,
}: {
  videoUrl: string;
  thumbnailUrl: string;
  index: number;
  likes: number;
  onClick: () => void;
}) {
  const [shouldLoad, setShouldLoad] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            setTimeout(() => {
              setShouldLoad(true);
              videoRef.current?.play().catch(() => {});
            }, index * 200);
          } else {
            setShouldLoad(false);
            if (videoRef.current) {
              videoRef.current.pause();
              videoRef.current.src = '';
            }
          }
        });
      },
      { threshold: 0.3 }
    );
    if (containerRef.current) observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [index]);

  return (
    <div
      ref={containerRef}
      className="aspect-square relative overflow-hidden rounded-lg shadow-md cursor-pointer group"
      onClick={onClick}
      style={{ containIntrinsicSize: 'auto 400px' }}
    >
      {shouldLoad ? (
        <video
          ref={videoRef}
          src={videoUrl}
          poster={thumbnailUrl}
          width="400"
          height="400"
          autoPlay
          muted
          playsInline
          preload="none"
          className="w-full h-full object-cover"
          onTimeUpdate={(e) => {
            const video = e.currentTarget as HTMLVideoElement;
            if (video.currentTime >= 10) {
              video.currentTime = 0;
              // ensure playback resumes immediately after resetting
              video.play().catch(() => {});
            }
          }}
        />
      ) : (
        <img
          src={thumbnailUrl}
          alt="Video thumbnail"
          width="400"
          height="400"
          className="w-full h-full object-cover"
          loading="lazy"
        />
      )}
      <div className="absolute bottom-2 left-2 bg-black bg-opacity-60 rounded-full p-2">
        <span className="text-white text-xl">▶️</span>
      </div>
      {likes > 0 && (
        <div className="absolute bottom-2 right-2 bg-black bg-opacity-70 text-white px-2 py-1 rounded-full text-sm flex items-center gap-1">
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="#ef4444"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
          </svg>
          <span>{likes}</span>
        </div>
      )}
    </div>
  );
}

// ===================== Main Page =====================

export default function Home() {
  const [photos, setPhotos] = useState<PhotoData[]>([]);
  const [guestName, setGuestName] = useState<string | null>(null);  
  const [showModal, setShowModal] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState({ uploadedBytes: 0, totalBytes: 0 });
  const [showSuccess, setShowSuccess] = useState(false);
  const [selectedPhotoIndex, setSelectedPhotoIndex] = useState<number | null>(null);
  const [photoLikes, setPhotoLikes] = useState<Record<string, number>>({});
  const [userLikes, setUserLikes] = useState<Set<string>>(new Set());
  
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [failedFiles, setFailedFiles] = useState<File[]>([]);
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [shouldCancel, setShouldCancel] = useState(false);
  const shouldCancelRef = useRef(false);

  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const isLoadingMoreRef = useRef(false);
  const hasMoreRef = useRef(true);

  const [hasPreloadedInitial, setHasPreloadedInitial] = useState(false);
  const [hasLoadedFullInitial, setHasLoadedFullInitial] = useState(false);

  useEffect(() => {
    const savedName = getCookie('guestName');
    if (savedName) {
      setGuestName(savedName);
    } else {
      setShowModal(true);
    }
  }, []);

  useEffect(() => {
    if (selectedPhotoIndex === null) return;

    const preloadUrls: string[] = [];
    
    if (selectedPhotoIndex < photos.length - 1) {
      const nextPhoto = photos[selectedPhotoIndex + 1];
      if (nextPhoto.media_type === 'image') {
        preloadUrls.push(getWebUrl(nextPhoto.photo_url));
      }
    }
    
    if (selectedPhotoIndex > 0) {
      const prevPhoto = photos[selectedPhotoIndex - 1];
      if (prevPhoto.media_type === 'image') {
        preloadUrls.push(getWebUrl(prevPhoto.photo_url));
      }
    }

    preloadUrls.forEach(url => {
      const img = new window.Image();
      img.src = url;
    });
  }, [selectedPhotoIndex, photos]);

  const loadAllLikes = useCallback(async () => {
    try {
      const { data, error } = await supabase
        .from('likes')
        .select('photo_url, guest_name');

      if (error) {
        console.error('❌ Error cargando likes:', error);
        return;
      }

      const likesCount: Record<string, number> = {};
      const userLikesSet = new Set<string>();

      data.forEach(like => {
        likesCount[like.photo_url] = (likesCount[like.photo_url] || 0) + 1;

        if (like.guest_name === guestName) {
          userLikesSet.add(like.photo_url);
        }
      });

      setPhotoLikes(likesCount);
      setUserLikes(userLikesSet);
    } catch (error) {
      console.error('❌ Error:', error);
    }
  }, [guestName]);

  const loadMore = useCallback(async () => {
    if (isLoadingMoreRef.current || !hasMoreRef.current || photos.length === 0) {
      return;
    }
    
    isLoadingMoreRef.current = true;
    setIsLoadingMore(true);

    const lastPhoto = photos[photos.length - 1];
    const newPhotos = await loadMorePhotos(lastPhoto.id, 20);
    
    if (newPhotos.length === 0) {
      setHasMore(false);
      hasMoreRef.current = false;
    } else {
      setPhotos(prev => [...prev, ...newPhotos]);
    }

    setIsLoadingMore(false);
    isLoadingMoreRef.current = false;
  }, [photos]);

  useEffect(() => {
    if (!loadMoreRef.current || isInitialLoading) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingMoreRef.current && hasMoreRef.current) {
          loadMore();
        }
      },
      { 
        threshold: 0.1,
        rootMargin: '1000px'
      }
    );

    observerRef.current.observe(loadMoreRef.current);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [isInitialLoading, loadMore]);

  // Preload reducido mientras el modal está abierto (usuario aún sin identificar)
  useEffect(() => {
    async function preloadInitial() {
      // Si ya tenemos nombre o ya hicimos el preload, no hacemos nada
      if (guestName || hasPreloadedInitial) return;

      const isMobile = typeof window !== 'undefined' ? window.innerWidth < 768 : true;
      const limit = isMobile ? 8 : 20;

      setIsInitialLoading(true);
      const photosData = await loadInitialPhotos(limit);
      setPhotos(photosData);
      setHasPreloadedInitial(true);
      setIsInitialLoading(false);

      if (photosData.length < limit) {
        // No hay más fotos que las del preload → ya hemos cargado todo lo que hay
        setHasMore(false);
        hasMoreRef.current = false;
        setHasLoadedFullInitial(true);
      } else {
        setHasMore(true);
        hasMoreRef.current = true;
      }
    }

    // Solo hacemos preload si:
    // - el modal está visible
    // - NO tenemos guestName todavía
    // - y no hemos preloaded antes
    if (showModal && !guestName && !hasPreloadedInitial) {
      preloadInitial();
    }
  }, [showModal, guestName, hasPreloadedInitial]);

  // Completar la carga inicial hasta 60 elementos cuando ya conocemos el nombre del invitado
  useEffect(() => {
    async function loadRemainingInitial() {
      if (!guestName || hasLoadedFullInitial) return;

      const target = 60;
      const currentCount = photos.length;

      // Ya tenemos suficiente para la carga inicial
      if (currentCount >= target) {
        setHasLoadedFullInitial(true);
        return;
      }

      if (currentCount === 0) {
        // Caso: invitado recurrente con cookie (no hubo preload)
        setIsInitialLoading(true);
        const data = await loadInitialPhotos(target);
        setPhotos(data);
        setIsInitialLoading(false);
        setHasLoadedFullInitial(true);

        if (data.length < target) {
          setHasMore(false);
          hasMoreRef.current = false;
        } else {
          setHasMore(true);
          hasMoreRef.current = true;
        }
        return;
      }

      // Caso normal: ya tenemos un preload (8/20), completamos hasta 60 añadiendo más antiguas
      const lastPhoto = photos[photos.length - 1];
      const remaining = target - currentCount;
      const more = await loadMorePhotos(lastPhoto.id, remaining);

      setPhotos(prev => [...prev, ...more]);
      setHasLoadedFullInitial(true);

      if (more.length < remaining) {
        setHasMore(false);
        hasMoreRef.current = false;
      } else {
        setHasMore(true);
        hasMoreRef.current = true;
      }
    }

    loadRemainingInitial();
  }, [guestName, photos.length, hasLoadedFullInitial]);

  useEffect(() => {
    if (guestName && photos.length > 0) {
      loadAllLikes();
    }
  }, [guestName, photos.length, loadAllLikes]);

  const handleNameSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    const nameInput = (e.target as HTMLFormElement).elements.namedItem('guestName') as HTMLInputElement;
    const name = nameInput.value.trim();
    
    if (name) {
      setGuestName(name);
      localStorage.setItem('guestName', name);
      setCookie('guestName', name, 30);
      setShowModal(false);
    }
  };

  const deleteMedia = async (photoUrl: string, videoUrl?: string, mediaType?: 'image' | 'video') => {
    const confirmed = confirm('¿Seguro que quieres eliminar este archivo?');
    if (!confirmed) return;

    try {
      const extractFileName = (url: string): string | null => {
        const match = url.match(/\/([^/]+\.[a-z0-9]+)(?:\?|$)/i);
        return match ? match[1] : null;
      };

      const filesToDelete: string[] = [];

      if (videoUrl) {
        const thumbFileName = extractFileName(photoUrl);
        if (thumbFileName) {
          filesToDelete.push(thumbFileName);
        }

        const videoFileName = extractFileName(videoUrl);
        if (videoFileName) {
          await supabase.storage.from('wedding-videos').remove([videoFileName]);
        }
      } else {
        const thumbFileName = extractFileName(photoUrl);
        if (thumbFileName) {
          const baseId = thumbFileName.replace(/^(thumb_|web_|original_)/, '').replace(/\.[^.]+$/, '');
          
          filesToDelete.push(`thumb_${baseId}.jpg`);
          filesToDelete.push(`web_${baseId}.jpg`);
          filesToDelete.push(`original_${baseId}.jpg`);
        }
      }

      if (filesToDelete.length > 0) {
        await supabase.storage.from('wedding-photos').remove(filesToDelete);
      }

      await supabase.from('uploads').delete().eq('photo_url', photoUrl);

      setPhotos(prev => prev.filter(p => p.photo_url !== photoUrl));
      
      if (selectedPhotoIndex !== null) {
        setSelectedPhotoIndex(null);
      }
    } catch (error) {
      console.error('Error eliminando:', error);
      alert('Error al eliminar. Inténtalo de nuevo.');
    }
  };

  // Upload handler with batch support, parallel uploads (concurrency=3), progress, and single batch fetch
  const handleUpload = async (files: FileList) => {
    const fileArray = Array.from(files);
    if (fileArray.length === 0) return;

    // Validaciones de cantidad de archivos y peso para evitar que el navegador reviente
    const photos = fileArray.filter((f) => f.type.startsWith('image/'));
    const videos = fileArray.filter((f) => f.type.startsWith('video/'));

    // 1) Máximo 50 fotos si solo hay fotos
    if (videos.length === 0 && photos.length > 50) {
      alert('¡Eso son muchas fotos! Prueba 50 a la vez como máximo.');
      return;
    }

    // 2) Si hay uno o más vídeos:
    if (videos.length > 0) {
      // 2a) Máximo 1 vídeo por subida
      if (videos.length > 1) {
        alert('Solo puedes subir un vídeo por tanda. Sube ese primero y luego el siguiente.');
        return;
      }
      const totalVideoBytes = videos.reduce((sum, f) => sum + f.size, 0);
      const totalVideoMB = totalVideoBytes / (1024 * 1024);

      // 2b) Peso total de vídeo máximo 200 MB
      if (totalVideoMB > 200) {
        alert('El vídeo es muy pesado o muy largo, prueba con un vídeo más corto.');
        return;
      }

      // 2c) Si hay vídeos, máximo 10 fotos acompañando
      if (photos.length > 10) {
        alert('Has intentado subir demasiadas cosas a la vez, prueba a separar fotos y vídeos en diferentes tandas.');
        return;
      }
    }

    const totalBytes = fileArray.reduce((sum, file) => sum + file.size, 0);

    setIsUploading(true);
    setShouldCancel(false);
    shouldCancelRef.current = false;
    setUploadError(null);
    setFailedFiles([]);
    setUploadProgress({ uploadedBytes: 0, totalBytes });

    // ID único para este batch de subida
    const uploadBatchId = `batch_${Date.now()}_${Math.random().toString(36).substring(2, 10)}`;

    const failed: File[] = [];
    let uploadedSoFar = 0;

    // Helper para subir un fichero concreto, respetando cancelación y progreso
    const processFile = async (file: File) => {
      if (shouldCancelRef.current) return;

      const result = await uploadFile(file, guestName, setUploadError, uploadBatchId);

      if (shouldCancelRef.current) return;

      if (result) {
        uploadedSoFar += file.size;
        setUploadProgress({ uploadedBytes: uploadedSoFar, totalBytes });
      } else {
        failed.push(file);
      }
    };

    // Limitador de concurrencia: 3 uploads en paralelo
    const concurrency = 3;
    let currentIndex = 0;

    const workers = Array.from({ length: concurrency }).map(async () => {
      while (currentIndex < fileArray.length && !shouldCancelRef.current) {
        const file = fileArray[currentIndex++];
        await processFile(file);
      }
    });

    await Promise.all(workers);

    let newPhotos: PhotoData[] = [];

    if (!shouldCancelRef.current) {
      // Recuperar todas las filas de este batch de una sola vez
      const { data: batchRows, error } = await supabase
        .from('uploads')
        .select('id, photo_url, video_url, guest_name, media_type, duration, upload_batch')
        .eq('upload_batch', uploadBatchId)
        .order('id', { ascending: false });

      if (!error && batchRows && batchRows.length > 0) {
        newPhotos = batchRows as PhotoData[];
        setPhotos(prev => [...newPhotos, ...prev]);
      }
    }

    if (shouldCancelRef.current) {
      setUploadError('Subida cancelada');
    } else if (failed.length > 0) {
      setFailedFiles(failed);
      setUploadError(`${failed.length} archivo(s) fallaron al subir`);
    } else if (newPhotos.length > 0) {
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 4000);
    }

    setIsUploading(false);
    setShouldCancel(false);
    shouldCancelRef.current = false;
  };

  const openFileSelector = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.multiple = true;
    
    const isSafari = /^((?!chrome|android).)*safari/i.test(navigator.userAgent);
    const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
    
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      
      if (!files || files.length === 0) {
        if (isSafari && isIOS) {
          setTimeout(() => {
            alert('⚠️ Safari canceló la selección (probablemente por falta de memoria).\n\n' +
                  '💡 Soluciones:\n' +
                  '1. Cierra Safari completamente (desliza hacia arriba desde las apps abiertas)\n' +
                  '2. Vuelve a intentarlo\n' +
                  '3. O usa Chrome (soporta más fotos de golpe)');
          }, 100);
        }
        return;
      }
      
      handleUpload(files);
      input.value = '';
    };
    input.click();
  };

  const confirmCancel = () => {
    setShouldCancel(true);
    shouldCancelRef.current = true;
    setShowCancelModal(false);
  };

  const retryFailedUploads = () => {
    if (failedFiles.length === 0) return;
    
    const dt = new DataTransfer();
    failedFiles.forEach(file => dt.items.add(file));
    
    setUploadError(null);
    setFailedFiles([]);
    handleUpload(dt.files);
  };

  const toggleLike = async (photoUrl: string) => {
    if (!guestName) return;

    const hasLiked = userLikes.has(photoUrl);

    try {
      if (hasLiked) {
        const { error } = await supabase
          .from('likes')
          .delete()
          .eq('photo_url', photoUrl)
          .eq('guest_name', guestName);

        if (error) throw error;

        setUserLikes(prev => {
          const newSet = new Set(prev);
          newSet.delete(photoUrl);
          return newSet;
        });

        setPhotoLikes(prev => ({
          ...prev,
          [photoUrl]: Math.max(0, (prev[photoUrl] || 0) - 1)
        }));
      } else {
        const { error } = await supabase
          .from('likes')
          .insert({ photo_url: photoUrl, guest_name: guestName });

        if (error) throw error;

        setUserLikes(prev => new Set(prev).add(photoUrl));

        setPhotoLikes(prev => ({
          ...prev,
          [photoUrl]: (prev[photoUrl] || 0) + 1
        }));
      }
    } catch (error) {
      console.error('❌ Error toggling like:', error);
    }
  };

  const openPhotoModal = (index: number) => {
    setSelectedPhotoIndex(index);
  };

  const goToPrevPhoto = () => {
    if (selectedPhotoIndex === null) return;
    const newIndex = selectedPhotoIndex > 0 ? selectedPhotoIndex - 1 : photos.length - 1;
    openPhotoModal(newIndex);
  };

  const goToNextPhoto = () => {
    if (selectedPhotoIndex === null) return;
    const newIndex = selectedPhotoIndex < photos.length - 1 ? selectedPhotoIndex + 1 : 0;
    openPhotoModal(newIndex);
  };

  const closePhotoModal = () => {
    setSelectedPhotoIndex(null);
  };

  // Group photos by upload_batch for each guest for segment grouping
  const photosByGuestSegments = useMemo(() => {
    // Map: guestName => Map<batchId, PhotoData[]>
    const guestMap: Record<string, Record<string, PhotoData[]>> = {};
    for (const p of photos) {
      const name = p.guest_name || 'Anónimo';
      const batch = p.upload_batch || 'sin-batch';
      if (!guestMap[name]) guestMap[name] = {};
      if (!guestMap[name][batch]) guestMap[name][batch] = [];
      guestMap[name][batch].push(p);
    }
    // For each guest, create ordered segments by batch (most recent batch first)
    const result: Record<string, PhotoSegment[]> = {};
    for (const guest of Object.keys(guestMap)) {
      const batchEntries = Object.entries(guestMap[guest]);
      // Order batches by first photo id descending (most recent first)
      batchEntries.sort((a, b) => {
        const aMax = Math.max(...a[1].map(p => p.id));
        const bMax = Math.max(...b[1].map(p => p.id));
        return bMax - aMax;
      });
      result[guest] = batchEntries.map(([batchId, items]) => ({
        batchId,
        guestName: guest,
        items: items.sort((a, b) => b.id - a.id),
      }));
    }
    return result;
  }, [photos]);

  return (
    <>
      {showModal && (
        <div className="fixed inset-0 flex items-center justify-center p-4 z-50" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
          <div
            className="relative max-w-lg w-full"
            style={{ aspectRatio: '1.35/1', backgroundColor: 'transparent' }}
          >
            <Image
              src="/assets/tarjeta-fondo.png"
              alt=""
              fill
              priority
              className="object-contain absolute inset-0 w-full h-full"
            />
            
            <div className="absolute inset-0 flex items-center justify-center">
              <div className="w-[88%] max-w-md flex flex-col items-center gap-5 sm:gap-6 py-6 sm:py-8">
                <div className="flex flex-col items-center gap-3">
                  <div className="flex items-center justify-center">
                    <img
                      src="/assets/arbolito.png"
                      alt=""
                      className="w-14 h-14 sm:w-16 sm:h-16 object-contain"
                    />
                  </div>

                  <h2
                    className="text-2xl sm:text-3xl font-bold text-center"
                    style={{ color: '#6E0005' }}
                  >
                    ¡Hola!
                  </h2>

                  <p
                    className="text-center font-medium text-sm sm:text-base leading-relaxed"
                    style={{ color: '#6E0005', maxWidth: '360px' }}
                  >
                    Hemos creado esta web para que puedas subir todas tus fotos y vídeos de la boda
                  </p>
                </div>

                <form onSubmit={handleNameSubmit} className="w-full">
                  <input
                    type="text"
                    name="guestName"
                    required
                    placeholder="Escribe tu nombre"
                    className="w-full px-4 py-2 mb-3 rounded-lg text-center text-base"
                    style={{
                      backgroundColor: 'white',
                      border: '1px solid #D4C5BB',
                      color: '#6E0005',
                      fontSize: '16px',
                    }}
                  />

                  <button
                    type="submit"
                    className="w-full text-white py-2.5 rounded-lg font-semibold text-sm transition-opacity hover:opacity-90"
                    style={{ backgroundColor: '#364136' }}
                  >
                    Continuar
                  </button>
                </form>
              </div>
            </div>
          </div>
        </div>
      )}

      {showCancelModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold mb-4">
              ¿Cancelar subida?
            </h2>
            
            <p className="text-gray-700 mb-6">
              Se perderán las fotos que no se hayan subido todavía.
            </p>

            <div className="flex gap-3">
              <button
                onClick={confirmCancel}
                className="flex-1 bg-red-500 text-white py-2 rounded-lg font-semibold hover:bg-red-600 transition-colors"
              >
                Sí, cancelar
              </button>
              <button
                onClick={() => setShowCancelModal(false)}
                className="flex-1 bg-gray-300 text-gray-700 py-2 rounded-lg font-semibold hover:bg-gray-400 transition-colors"
              >
                No, continuar
              </button>
            </div>
          </div>
        </div>
      )}

      {uploadError && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold mb-4 text-red-600">
              ⚠️ Error al subir
            </h2>
            
            <p className="text-gray-700 mb-4">
              {uploadError}
            </p>

            {failedFiles.length > 0 && (
              <div className="mb-4 p-3 bg-gray-50 rounded max-h-32 overflow-y-auto">
                <p className="text-sm font-semibold mb-2">Archivos que fallaron:</p>
                <ul className="text-sm text-gray-600 list-disc list-inside">
                  {failedFiles.map((file, i) => (
                    <li key={i}>{file.name}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex gap-3">
              {failedFiles.length > 0 && (
                <button
                  onClick={retryFailedUploads}
                  className="flex-1 bg-rose-500 text-white py-2 rounded-lg font-semibold hover:bg-rose-600 transition-colors"
                >
                  Reintentar
                </button>
              )}
              <button
                onClick={() => {
                  setUploadError(null);
                  setFailedFiles([]);
                }}
                className="flex-1 bg-gray-300 text-gray-700 py-2 rounded-lg font-semibold hover:bg-gray-400 transition-colors"
              >
                Cerrar
              </button>
            </div>
          </div>
        </div>
      )}

      {selectedPhotoIndex !== null && (
        <div 
          className="fixed inset-0 bg-black bg-opacity-95 z-50 flex items-center justify-center"
          onClick={closePhotoModal}
        >
          <div 
            className="relative w-full h-full flex items-center justify-center p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={closePhotoModal}
              className="absolute top-4 right-4 text-white text-4xl hover:text-gray-300 z-10"
            >
              ×
            </button>

            {photos[selectedPhotoIndex].guest_name === guestName && (
              <button
                onClick={() => deleteMedia(photos[selectedPhotoIndex].photo_url, photos[selectedPhotoIndex].video_url)}
                className="absolute top-4 right-16 text-white bg-red-500 p-2 rounded-full hover:bg-red-600 z-10"
                title="Eliminar"
              >
                <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>
                </svg>
              </button>
            )}

            <button
              onClick={goToPrevPhoto}
              className="absolute left-4 text-white text-4xl hover:text-gray-300 z-10"
            >
              ‹
            </button>

            <div className="max-w-4xl max-h-full flex flex-col items-center gap-6">
              {photos[selectedPhotoIndex].media_type === 'video' && photos[selectedPhotoIndex].video_url ? (
                <video
                  src={photos[selectedPhotoIndex].video_url}
                  controls
                  autoPlay
                  playsInline
                  className="max-w-full max-h-[60vh] rounded-lg"
                />
              ) : (
                <ImageWithLoader 
                  src={getWebUrl(photos[selectedPhotoIndex].photo_url)}
                  alt="Foto"
                />
              )}

              <button
                onClick={() => toggleLike(photos[selectedPhotoIndex].photo_url)}
                className="flex items-center gap-3 text-white hover:scale-110 transition-transform"
              >
                {userLikes.has(photos[selectedPhotoIndex].photo_url) ? (
                  <svg 
                    width="40" 
                    height="40" 
                    viewBox="0 0 24 24" 
                    fill="#ef4444"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                  </svg>
                ) : (
                  <svg 
                    width="40" 
                    height="40" 
                    viewBox="0 0 24 24" 
                    fill="none"
                    stroke="white"
                    strokeWidth="2"
                    xmlns="http://www.w3.org/2000/svg"
                  >
                    <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
                  </svg>
                )}
                <span className="text-2xl font-bold">
                  {photoLikes[photos[selectedPhotoIndex].photo_url] || 0}
                </span>
              </button>
            </div>

            <button
              onClick={goToNextPhoto}
              className="absolute right-4 text-white text-4xl hover:text-gray-300 z-10"
            >
              ›
            </button>
          </div>
        </div>
      )}

      <header className="sticky top-0 z-40" style={{ backgroundColor: '#F4EAE3' }}>
        <div className="flex items-center justify-center py-2 px-4">
          <div className="relative w-40 h-12">
            <Image
              src="/Carlos + Andrea.png"
              alt="Carlos + Andrea"
              fill
              className="object-contain"
              priority
            />
          </div>
        </div>
      </header>

      <main className="min-h-screen pb-32" style={{ backgroundColor: '#F4EAE3' }}>
        <div className="max-w-6xl mx-auto px-4 py-8">
          {isInitialLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              <GallerySkeleton count={12} />
            </div>
          ) : Object.keys(photosByGuestSegments).length === 0 ? (
            <div className="text-center py-20">
              <p className="text-gray-400 text-lg">
                Aún no hay fotos. ¡Sé el primero en subir! 📸
              </p>
            </div>
          ) : (
            <>
              {Object.entries(photosByGuestSegments).map(([guestName, segments]) => {
                return (
                  <div key={guestName} className="mb-12">
                    {segments.map((segment, batchIdx) => {
                      const photoCount = segment.items.filter(i => i.media_type === 'image').length;
                      const videoCount = segment.items.filter(i => i.media_type === 'video').length;
                      return (
                        <div key={segment.batchId} className={batchIdx > 0 ? 'mt-8' : ''}>
                          <div
                            className="mb-2 text-lg"
                            style={{
                              color: '#6E0005',
                              fontFamily: 'DM Sans, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
                              fontWeight: '700',
                            }}
                          >
                            {segment.guestName} ha subido{" "}
                            {photoCount > 0 ? `${photoCount} ${photoCount === 1 ? 'foto' : 'fotos'}` : ''}
                            {photoCount > 0 && videoCount > 0 ? ' y ' : ''}
                            {videoCount > 0 ? `${videoCount} ${videoCount === 1 ? 'vídeo' : 'vídeos'}` : ''}
                          </div>
                          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                            {segment.items.map((item, index) => {
                              const globalIndex = photos.findIndex(p => p.id === item.id);
                              const likes = photoLikes[item.photo_url] || 0;
                              const isFirstRow = globalIndex < 4;
                              return item.media_type === 'video' && item.video_url ? (
                                <VideoInGallery
                                  key={item.id}
                                  videoUrl={item.video_url}
                                  thumbnailUrl={item.photo_url}
                                  index={index}
                                  likes={likes}
                                  onClick={() => openPhotoModal(globalIndex)}
                                />
                              ) : (
                                <div
                                  key={item.id}
                                  className="aspect-square relative overflow-hidden rounded-lg shadow-md cursor-pointer group"
                                  onClick={() => openPhotoModal(globalIndex)}
                                  style={{ containIntrinsicSize: 'auto 400px' }}
                                >
                                  <img
                                    src={item.photo_url}
                                    alt={`Foto de ${guestName}`}
                                    width="400"
                                    height="400"
                                    className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                                    loading={isFirstRow ? 'eager' : 'lazy'}
                                    fetchPriority={isFirstRow ? 'high' : 'auto'}
                                  />
                                  {likes > 0 && (
                                    <div className="absolute bottom-2 right-2 bg-black bg-opacity-70 text-white px-2 py-1 rounded-full text-sm flex items-center gap-1">
                                      <svg
                                        width="16"
                                        height="16"
                                        viewBox="0 0 24 24"
                                        fill="#ef4444"
                                        xmlns="http://www.w3.org/2000/svg"
                                      >
                                        <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z" />
                                      </svg>
                                      <span>{likes}</span>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              <div ref={loadMoreRef} className="h-20 flex items-center justify-center">
                {isLoadingMore && (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4 w-full">
                    <GallerySkeleton count={8} />
                  </div>
                )}
                {!hasMore && photos.length > 0 && (
                  <p className="text-gray-400 text-sm">
                    ¡Has visto todas las fotos! 🎉
                  </p>
                )}
              </div>
            </>
          )}
        </div>
      </main>

      {selectedPhotoIndex === null && !showModal && (
        <button
          onClick={() => {
            if (isUploading) {
              setShowCancelModal(true);
            } else {
              openFileSelector();
            }
          }}
          disabled={showSuccess}
          className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50"
          style={{ filter: 'drop-shadow(0 8px 16px rgba(0, 0, 0, 0.3))' }}
        >
          <div className="relative w-[104px] h-[104px] flex items-center justify-center">
            {isUploading && (
              <svg 
                className="absolute w-[104px] h-[104px]" 
                viewBox="0 0 104 104"
              >
                <circle
                  cx="52"
                  cy="52"
                  r="47"
                  stroke="#e5e7eb"
                  strokeWidth="8"
                  fill="none"
                  transform="rotate(-90 52 52)"
                />
                
                <circle
                  cx="52"
                  cy="52"
                  r="47"
                  stroke="#10b981"
                  strokeWidth="8"
                  fill="none"
                  strokeDasharray={`${2 * Math.PI * 47}`}
                  strokeDashoffset={`${2 * Math.PI * 47 * (1 - (uploadProgress.totalBytes > 0 ? uploadProgress.uploadedBytes / uploadProgress.totalBytes : 0))}`}
                  strokeLinecap="round"
                  transform="rotate(-90 52 52)"
                  className="transition-all duration-300"
                />
              </svg>
            )}

            <div 
              className="w-[84px] h-[84px] rounded-full flex items-center justify-center shadow-lg z-10 transition-colors duration-300"
              style={{
                backgroundColor: showSuccess ? '#10b981' : isUploading ? '#3b82f6' : '#6E0005'
              }}
            >
              {showSuccess ? (
                <div className="w-[62px] h-[62px]">
                  <Lottie 
                    key={Date.now()}
                    animationData={checkSuccessAnimation} 
                    loop={false}
                    autoplay={true}
                    style={{ width: '100%', height: '100%' }}
                  />
                </div>
              ) : isUploading ? (
                <div className="w-[52px] h-[52px]" style={{ filter: 'brightness(0) invert(1)' }}>
                  <Lottie 
                    animationData={uploadArrowAnimation} 
                    loop={true}
                    style={{ width: '100%', height: '100%' }}
                  />
                </div>
              ) : (
                <span className="text-[48px] text-white font-bold">+</span>
              )}
            </div>
          </div>
        </button>
      )}
    </>
  );
}