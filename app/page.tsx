/* eslint-disable @next/next/no-img-element */
'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import { supabase } from '@/app/lib/supabase';
import Image from 'next/image';
import Lottie from 'lottie-react';
import uploadArrowAnimation from '@/public/animations/upload-arrow.json';
import checkSuccessAnimation from '@/public/animations/check-success.json';
import imageCompression from 'browser-image-compression';

// ============================================
// FUNCIONES AUXILIARES
// ============================================

// Gestión de cookies para el nombre del invitado
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

// Crear placeholder para videos (gris + icono play)
function createPlaceholder(): Blob {
  const canvas = document.createElement('canvas');
  canvas.width = 400;
  canvas.height = 400;
  const ctx = canvas.getContext('2d')!;
  
  // Fondo gris oscuro
  ctx.fillStyle = '#1f2937';
  ctx.fillRect(0, 0, 400, 400);
  
  // Icono play blanco
  ctx.fillStyle = '#ffffff';
  ctx.font = 'bold 100px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('▶', 200, 200);
  
  // Convertir a Blob sincrónicamente usando dataURL
  const dataUrl = canvas.toDataURL('image/jpeg', 0.8);
  const byteString = atob(dataUrl.split(',')[1]);
  const mimeString = dataUrl.split(',')[0].split(':')[1].split(';')[0];
  const ab = new ArrayBuffer(byteString.length);
  const ia = new Uint8Array(ab);
  for (let i = 0; i < byteString.length; i++) {
    ia[i] = byteString.charCodeAt(i);
  }
  return new Blob([ab], { type: mimeString });
}

// Obtener duración del video
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

// Upload de archivo (foto o video)
async function uploadFile(
  file: File, 
  guestName: string | null,
  onError: (msg: string) => void
): Promise<{ url: string; mediaType: 'image' | 'video'; videoUrl?: string; duration?: number } | null> {
  try {
    const isVideo = file.type.startsWith('video/');

    // ============================================
    // VIDEOS → Supabase Storage
    // ============================================
    if (isVideo) {
      // 1. VALIDAR PESO
      const sizeMB = file.size / 1024 / 1024;
      
      if (sizeMB > 200) {
        onError('Video muy grande. Máximo 200MB.');
        return null;
      }
      
      if (sizeMB > 100) {
        const confirmed = confirm(`⚠️ Este video pesa ${sizeMB.toFixed(0)}MB. ¿Continuar? (puede tardar)`);
        if (!confirmed) return null;
      }

      // 2. OBTENER DURACIÓN
      let duration = 0;
      try {
        duration = await getVideoDuration(file);
      } catch (error) {
        // Continuar sin duración si falla
      }

      // 3. CREAR PLACEHOLDER
      const thumbnailBlob = createPlaceholder();

      // 4. SUBIR THUMBNAIL
      const timestamp = Date.now();
      const randomId = Math.random().toString(36).substring(7);
      const thumbFileName = `thumb_video_${timestamp}-${randomId}.jpg`;
      
      const { error: thumbError } = await supabase.storage
        .from('wedding-photos')
        .upload(thumbFileName, thumbnailBlob);

      if (thumbError) {
        console.error('Error subiendo thumbnail:', thumbError);
        onError('Error subiendo thumbnail del video.');
        return null;
      }

      const { data: { publicUrl: thumbnailUrl } } = supabase.storage
        .from('wedding-photos')
        .getPublicUrl(thumbFileName);

      // 5. SUBIR VIDEO
      const videoFileName = `video_${timestamp}-${randomId}.${file.name.split('.').pop()}`;
      
      const { error: videoError } = await supabase.storage
        .from('wedding-videos')
        .upload(videoFileName, file);

      if (videoError) {
        console.error('Error subiendo video:', videoError);
        onError('Error subiendo video.');
        return null;
      }

      const { data: { publicUrl: videoUrl } } = supabase.storage
        .from('wedding-videos')
        .getPublicUrl(videoFileName);

      // 6. GUARDAR EN DB
      const { error: dbError } = await supabase
        .from('uploads')
        .insert({
          photo_url: thumbnailUrl,
          video_url: videoUrl,
          guest_name: guestName,
          media_type: 'video',
          duration: duration
        });

      if (dbError) {
        console.error('❌ Error guardando en DB:', dbError);
        return null;
      }

      return { 
        url: thumbnailUrl, 
        mediaType: 'video',
        videoUrl: videoUrl,
        duration: duration
      };
    }

    // ============================================
    // IMÁGENES → Supabase Storage (3 versiones)
    // ============================================
    const timestamp = Date.now();
    const randomId = Math.random().toString(36).substring(7);
    const baseFileName = `${timestamp}-${randomId}`;

    // 1. SUBIR ORIGINAL
    const originalFileName = `original_${baseFileName}.jpg`;
    
    const { error: originalError } = await supabase.storage
      .from('wedding-photos')
      .upload(originalFileName, file);

    if (originalError) {
      console.error('Error subiendo original:', originalError);
      return null;
    }

    // 2. VERSIÓN WEB
    const webOptions = {
      maxSizeMB: 0.5,
      maxWidthOrHeight: 1920,
      useWebWorker: true,
      fileType: 'image/jpeg'
    };

    const webFile = await imageCompression(file, webOptions);
    const webFileName = `web_${baseFileName}.jpg`;

    const { error: webError } = await supabase.storage
      .from('wedding-photos')
      .upload(webFileName, webFile);

    if (webError) {
      console.error('Error subiendo web:', webError);
      return null;
    }

    // 3. THUMBNAIL
    const thumbOptions = {
      maxSizeMB: 0.05,
      maxWidthOrHeight: 400,
      useWebWorker: true,
      fileType: 'image/jpeg'
    };

    const thumbFile = await imageCompression(file, thumbOptions);
    const thumbFileName = `thumb_${baseFileName}.jpg`;

    const { error: thumbError } = await supabase.storage
      .from('wedding-photos')
      .upload(thumbFileName, thumbFile);

    if (thumbError) {
      console.error('Error subiendo thumbnail:', thumbError);
      return null;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('wedding-photos')
      .getPublicUrl(thumbFileName);

    console.log('✅ 3 versiones subidas correctamente');

    const { error: dbError } = await supabase
      .from('uploads')
      .insert({
        photo_url: publicUrl,
        video_url: null,
        guest_name: guestName,
        media_type: 'image',
      });

    if (dbError) {
      console.error('❌ Error guardando en DB:', dbError);
      return null;
    }

    return { url: publicUrl, mediaType: 'image' };

  } catch (error) {
    console.error('❌ Error:', error);
    return null;
  }
}

interface PhotoData {
  photo_url: string;
  video_url?: string;
  guest_name: string | null;
  media_type: 'image' | 'video';
  duration?: number;
}

async function loadPhotos(limit: number = 30, offset: number = 0): Promise<PhotoData[]> {
  try {
    const { data, error } = await supabase
      .from('uploads')
      .select('photo_url, video_url, guest_name, media_type, duration')
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      console.error('❌ Error cargando fotos:', error);
      return [];
    }

    console.log(`📷 Fotos cargadas: ${data.length} (offset: ${offset})`);
    return data;

  } catch (error) {
    console.error('❌ Error:', error);
    return [];
  }
}

// Función helper para obtener versión web de una URL de thumbnail
function getWebUrl(thumbUrl: string): string {
  return thumbUrl.replace('thumb_', 'web_');
}

// ============================================
// COMPONENTES
// ============================================

// Componente Skeleton para galería
function GallerySkeleton({ count = 8 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="aspect-square relative overflow-hidden rounded-lg bg-gray-200 animate-pulse"
        />
      ))}
    </>
  );
}

// Componente de imagen con loading state para modal
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

// Componente VideoInGallery con lazy load y #t=0,10
function VideoInGallery({ 
  videoUrl, 
  thumbnailUrl, 
  index,
  likes, 
  onClick
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
        entries.forEach(entry => {
          if (entry.isIntersecting) {
            // Delay progresivo según posición
            setTimeout(() => {
              setShouldLoad(true);
              videoRef.current?.play().catch(() => {
                // Ignorar errores de autoplay
              });
            }, index * 200);
          } else {
            // Salió del viewport: limpiar
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

    if (containerRef.current) {
      observer.observe(containerRef.current);
    }

    return () => observer.disconnect();
  }, [index]);

  return (
    <div 
      ref={containerRef}
      className="aspect-square relative overflow-hidden rounded-lg shadow-md cursor-pointer group"
      onClick={onClick}
    >
      {shouldLoad ? (
        <video
          ref={videoRef}
          src={`${videoUrl}#t=0,10`}
          poster={thumbnailUrl}
          autoPlay
          loop={false}
          muted
          playsInline
          preload="none"
          className="w-full h-full object-cover"
          onTimeUpdate={(e) => {
            const video = e.target as HTMLVideoElement;
            
            // Si llega a 10 segundos (o más), reiniciar
            if (video.currentTime >= 10) {
              video.currentTime = 0;
              video.play().catch(() => {
                // Ignorar errores de autoplay
              });
            }
          }}
        />
      ) : (
        <img 
          src={thumbnailUrl}
          alt="Video thumbnail"
          className="w-full h-full object-cover"
          loading="lazy"
        />
      )}
      
      {/* Icono play */}
      <div className="absolute bottom-2 left-2 bg-black bg-opacity-60 rounded-full p-2">
        <span className="text-white text-xl">▶️</span>
      </div>
      
      {/* Likes */}
      {likes > 0 && (
        <div className="absolute bottom-2 right-2 bg-black bg-opacity-70 text-white px-2 py-1 rounded-full text-sm flex items-center gap-1">
          <svg 
            width="16" 
            height="16" 
            viewBox="0 0 24 24" 
            fill="#ef4444"
            xmlns="http://www.w3.org/2000/svg"
          >
            <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
          </svg>
          <span>{likes}</span>
        </div>
      )}
    </div>
  );
}

// ============================================
// COMPONENTE PRINCIPAL
// ============================================

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

  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [isInitialLoading, setIsInitialLoading] = useState(true);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  // Cargar nombre desde cookie al montar
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

      console.log('❤️ Likes cargados:', Object.keys(likesCount).length, 'fotos con likes');
    } catch (error) {
      console.error('❌ Error:', error);
    }
  }, [guestName]);

  const loadMore = useCallback(async () => {
    if (isLoadingMore || !hasMore) return;

    setIsLoadingMore(true);
    console.log('📷 Cargando más fotos...');

    const newPhotos = await loadPhotos(20, photos.length);
    
    if (newPhotos.length === 0) {
      setHasMore(false);
      console.log('✅ No hay más fotos');
    } else {
      setPhotos(prev => [...prev, ...newPhotos]);
      console.log(`✅ ${newPhotos.length} fotos más cargadas`);
    }

    setIsLoadingMore(false);
  }, [photos.length, isLoadingMore, hasMore]);

  useEffect(() => {
    if (!loadMoreRef.current) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !isLoadingMore && hasMore) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    observerRef.current.observe(loadMoreRef.current);

    return () => {
      if (observerRef.current) {
        observerRef.current.disconnect();
      }
    };
  }, [loadMore, isLoadingMore, hasMore]);

  useEffect(() => {
    const savedName = localStorage.getItem('guestName');
    if (savedName) {
      setGuestName(savedName);
      setShowModal(false);
    }

    async function fetchData() {
      setIsInitialLoading(true);
      
      const photosData = await loadPhotos(30, 0);
      setPhotos(photosData);
      
      if (photosData.length < 30) {
        setHasMore(false);
      }
      
      setIsInitialLoading(false);
    }
    
    fetchData();
  }, []);

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
      setCookie('guestName', name, 30); // Cookie dura 30 días
      setShowModal(false);
    }
  };

  const deleteMedia = async (photoUrl: string, videoUrl?: string) => {
    const confirmed = confirm('¿Seguro que quieres eliminar este archivo?');
    if (!confirmed) return;

    try {
      // 1. Extraer nombres de archivo de las URLs
      const photoFileName = photoUrl.split('/').pop();
      
      // 2. Borrar de Storage
      if (photoFileName) {
        await supabase.storage.from('wedding-photos').remove([photoFileName]);
      }
      
      if (videoUrl) {
        const videoFileName = videoUrl.split('/').pop();
        if (videoFileName) {
          await supabase.storage.from('wedding-videos').remove([videoFileName]);
        }
      }

      // 3. Borrar de DB
      await supabase.from('uploads').delete().eq('photo_url', photoUrl);

      // 4. Actualizar UI
      setPhotos(prev => prev.filter(p => p.photo_url !== photoUrl));
      
      // 5. Cerrar modal si está abierto
      if (selectedPhotoIndex !== null) {
        setSelectedPhotoIndex(null);
      }
    } catch (error) {
      console.error('Error eliminando:', error);
      alert('Error al eliminar. Inténtalo de nuevo.');
    }
  };

  const handleUpload = async (files: FileList) => {
    const fileArray = Array.from(files);

    // Calcular peso total en bytes
    const totalBytes = fileArray.reduce((sum, file) => sum + file.size, 0);

    setIsUploading(true);
    setShouldCancel(false);
    setUploadError(null);
    setFailedFiles([]);
    setUploadProgress({ uploadedBytes: 0, totalBytes });

    const newPhotos: PhotoData[] = [];
    const failed: File[] = [];
    let uploadedSoFar = 0; // Acumulador de bytes completados
    
    for (let i = 0; i < fileArray.length; i++) {
      if (shouldCancel) {
        setUploadError('Subida cancelada');
        break;
      }

      const file = fileArray[i];
      
      const result = await uploadFile(file, guestName, setUploadError);
      
      if (result) {
        newPhotos.push({ 
          photo_url: result.url, 
          video_url: result.videoUrl,
          guest_name: guestName,
          media_type: result.mediaType,
          duration: result.duration
        });
        
        // Archivo completado, actualizar progreso
        uploadedSoFar += file.size;
        setUploadProgress({ uploadedBytes: uploadedSoFar, totalBytes });
      } else {
        failed.push(file);
      }
    }
    
    if (newPhotos.length > 0) {
      setPhotos(prev => [...newPhotos, ...prev]);
    }

    if (failed.length > 0 && !shouldCancel) {
      setFailedFiles(failed);
      setUploadError(`${failed.length} archivo(s) fallaron al subir`);
    } else if (!shouldCancel && newPhotos.length > 0) {
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 4000);
    }

    setIsUploading(false);
    setShouldCancel(false);
  };

  const openFileSelector = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*,video/*';
    input.multiple = true;
    input.onchange = (e) => {
      const files = (e.target as HTMLInputElement).files;
      if (files && files.length > 0) {
        handleUpload(files);
      }
      // Resetear el input para permitir seleccionar el mismo archivo de nuevo
      input.value = '';
    };
    input.click();
  };

  const confirmCancel = () => {
    setShouldCancel(true);
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

  // Agrupar fotos por persona
  const photosByGuest = photos.reduce((acc, photo) => {
    const name = photo.guest_name || 'Anónimo';
    if (!acc[name]) {
      acc[name] = [];
    }
    acc[name].push(photo);
    return acc;
  }, {} as Record<string, PhotoData[]>);

  return (
    <>
      {/* Modal de bienvenida */}
      {showModal && (
        <div className="fixed inset-0 flex items-center justify-center p-4 z-50" style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}>
          <div className="rounded-lg shadow-xl max-w-md w-full p-6 sm:p-8" style={{ backgroundColor: '#F4EAE3' }}>
            <h2 className="text-2xl font-bold mb-4 text-center" style={{ color: '#6E0005' }}>
              ¡Hola! 💕
            </h2>
            
            <p className="mb-6 text-center" style={{ color: '#6E0005' }}>
              Comparte tus mejores fotos de la boda. Los vídeos, ¡todos bienvenidos!
            </p>
      
            <form onSubmit={handleNameSubmit}>
              <label className="block mb-4">
                <span className="text-sm font-medium block mb-2" style={{ color: '#6E0005' }}>
                  Tu nombre
                </span>
                <input
                  type="text"
                  name="guestName"
                  required
                  placeholder="Ej: María"
                  className="w-full px-4 py-3 border rounded-lg"
                  style={{ 
                    backgroundColor: 'white',
                    borderColor: '#6E0005',
                    color: '#6E0005'
                  }}
                />
              </label>
      
              <button
                type="submit"
                className="w-full text-white py-3 rounded-lg font-semibold transition-opacity hover:opacity-90"
                style={{ backgroundColor: '#364136' }}
              >
                Continuar
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Modal de confirmación de cancelar */}
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

      {/* Modal de error */}
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

      {/* Modal fullscreen de foto/video */}
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

            {/* Botón eliminar (solo si es del usuario actual) */}
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

      {/* Header sticky */}
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

      {/* Contenido principal */}
      <main className="min-h-screen pb-32" style={{ backgroundColor: '#F4EAE3' }}>
        <div className="max-w-6xl mx-auto px-4 py-8">
          {isInitialLoading ? (
            <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
              <GallerySkeleton count={12} />
            </div>
          ) : Object.keys(photosByGuest).length === 0 ? (
            <div className="text-center py-20">
              <p className="text-gray-400 text-lg">
                Aún no hay fotos. ¡Sé el primero en subir! 📸
              </p>
            </div>
          ) : (
            <>
              {Object.entries(photosByGuest).map(([name, items]) => {
                const photoCount = items.filter(i => i.media_type === 'image').length;
                const videoCount = items.filter(i => i.media_type === 'video').length;
                
                let subtitle = '';
                if (photoCount > 0 && videoCount > 0) {
                  subtitle = `${photoCount} ${photoCount === 1 ? 'foto' : 'fotos'} y ${videoCount} ${videoCount === 1 ? 'vídeo' : 'vídeos'}`;
                } else if (photoCount > 0) {
                  subtitle = `${photoCount} ${photoCount === 1 ? 'foto' : 'fotos'}`;
                } else {
                  subtitle = `${videoCount} ${videoCount === 1 ? 'vídeo' : 'vídeos'}`;
                }

                return (
                  <div key={name} className="mb-12">
                    <h2 className="text-xl font-semibold mb-4 text-gray-800">
                      {name} subió {subtitle}
                    </h2>
                    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
                      {items.map((item, index) => {
                        const globalIndex = photos.findIndex(p => p.photo_url === item.photo_url);
                        const likes = photoLikes[item.photo_url] || 0;
                        
                        return item.media_type === 'video' && item.video_url ? (
                          <VideoInGallery
                            key={index}
                            videoUrl={item.video_url}
                            thumbnailUrl={item.photo_url}
                            index={index}
                            likes={likes}
                            onClick={() => openPhotoModal(globalIndex)}
                          />
                        ) : (
                          <div 
                            key={index} 
                            className="aspect-square relative overflow-hidden rounded-lg shadow-md cursor-pointer group"
                            onClick={() => openPhotoModal(globalIndex)}
                          >
                            <img
                              src={item.photo_url}
                              alt={`Foto de ${name}`}
                              className="w-full h-full object-cover group-hover:scale-110 transition-transform duration-300"
                              loading="lazy"
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
                                  <path d="M12 21.35l-1.45-1.32C5.4 15.36 2 12.28 2 8.5 2 5.42 4.42 3 7.5 3c1.74 0 3.41.81 4.5 2.09C13.09 3.81 14.76 3 16.5 3 19.58 3 22 5.42 22 8.5c0 3.78-3.4 6.86-8.55 11.54L12 21.35z"/>
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

              {/* Trigger para infinite scroll */}
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

      {/* Botón flotante */}
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
        >
          <div className="relative w-20 h-20 flex items-center justify-center">
            {isUploading && (
              <svg 
                className="absolute w-20 h-20" 
                viewBox="0 0 80 80"
              >
                <circle
                  cx="40"
                  cy="40"
                  r="36"
                  stroke="#e5e7eb"
                  strokeWidth="6"
                  fill="none"
                  transform="rotate(-90 40 40)"
                />
                
                <circle
                  cx="40"
                  cy="40"
                  r="36"
                  stroke="#10b981"
                  strokeWidth="6"
                  fill="none"
                  strokeDasharray={`${2 * Math.PI * 36}`}
                  strokeDashoffset={`${2 * Math.PI * 36 * (1 - (uploadProgress.totalBytes > 0 ? uploadProgress.uploadedBytes / uploadProgress.totalBytes : 0))}`}
                  strokeLinecap="round"
                  transform="rotate(-90 40 40)"
                  className="transition-all duration-300"
                />
              </svg>
            )}

            <div 
              className="w-16 h-16 rounded-full flex items-center justify-center shadow-lg z-10 transition-colors duration-300"
              style={{
                backgroundColor: showSuccess ? '#10b981' : isUploading ? '#3b82f6' : '#6E0005'
              }}
            >
              {showSuccess ? (
                <div className="w-12 h-12">
                  <Lottie 
                    key={Date.now()}
                    animationData={checkSuccessAnimation} 
                    loop={false}
                    autoplay={true}
                    style={{ width: '100%', height: '100%' }}
                  />
                </div>
              ) : isUploading ? (
                <div className="w-10 h-10" style={{ filter: 'brightness(0) invert(1)' }}>
                  <Lottie 
                    animationData={uploadArrowAnimation} 
                    loop={true}
                    style={{ width: '100%', height: '100%' }}
                  />
                </div>
              ) : (
                <span className="text-3xl text-white font-bold">+</span>
              )}
            </div>
          </div>
        </button>
      )}
    </>
  );
}