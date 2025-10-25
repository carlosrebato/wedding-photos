'use client';

import { useState, useEffect } from 'react';
import { supabase } from '@/app/lib/supabase';

async function uploadFile(file: File): Promise<string | null> {
  try {
    const fileExt = file.name.split('.').pop();
    const fileName = `${Date.now()}-${Math.random().toString(36).substring(7)}.${fileExt}`;
    
    console.log('⬆️ Subiendo:', fileName);

    const { data, error } = await supabase.storage
      .from('wedding-photos')
      .upload(fileName, file);

    if (error) {
      console.error('❌ Error subiendo:', error);
      return null;
    }

    const { data: { publicUrl } } = supabase.storage
      .from('wedding-photos')
      .getPublicUrl(fileName);

    console.log('✅ Subido a Storage:', publicUrl);

    const { error: dbError } = await supabase
      .from('uploads')
      .insert({
        photo_url: publicUrl,
        guest_name: null
      });

    if (dbError) {
      console.error('❌ Error guardando en DB:', dbError);
      return null;
    }

    console.log('✅ Guardado en DB');
    return publicUrl;

  } catch (error) {
    console.error('❌ Error:', error);
    return null;
  }
}

async function loadPhotos(): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from('uploads')
      .select('photo_url')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('❌ Error cargando fotos:', error);
      return [];
    }

    console.log('📷 Fotos cargadas:', data.length);
    return data.map(row => row.photo_url);

  } catch (error) {
    console.error('❌ Error:', error);
    return [];
  }
}

export default function Home() {
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [uploadedUrls, setUploadedUrls] = useState<string[]>([]);

  useEffect(() => {
    async function fetchPhotos() {
      const photos = await loadPhotos();
      setUploadedUrls(photos);
    }
    fetchPhotos();
  }, []);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      const fileArray = Array.from(files);
      console.log('📸 Archivos seleccionados:', fileArray);
      setSelectedFiles(fileArray);

      console.log('⬆️ Iniciando subida...');
      const urls: string[] = [];
      
      for (const file of fileArray) {
        const url = await uploadFile(file);
        if (url) {
          console.log('✅ Foto subida:', url);
          urls.push(url);
        }
      }
      
      setUploadedUrls(prev => [...urls, ...prev]);
      console.log('🎉 Todas las fotos subidas!');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-4 sm:p-6">
      <div className="text-center mb-8 sm:mb-12">
        <h1 className="text-3xl sm:text-4xl md:text-5xl font-bold mb-3 sm:mb-4">
          Carlos + Andrea
        </h1>
        <p className="text-base sm:text-lg text-gray-600 px-4">
          Comparte tus fotos favoritas de nuestra boda
        </p>
      </div>

      <div className="w-full max-w-md bg-white p-6 sm:p-8 rounded-lg shadow-md">
        <label className="block">
          <span className="sr-only">Seleccionar fotos</span>
          <input
            type="file"
            accept="image/*"
            multiple
            onChange={handleFileChange}
            className="block w-full text-sm sm:text-base text-gray-500
              file:mr-4 file:py-3 file:px-6
              file:rounded-full file:border-0
              file:text-base file:font-semibold
              file:bg-rose-50 file:text-rose-700
              hover:file:bg-rose-100
              file:cursor-pointer
              cursor-pointer"
          />
        </label>
        
        {selectedFiles.length > 0 && (
          <div className="mt-4 p-4 bg-green-50 rounded-lg text-center">
            <p className="text-lg font-bold text-green-800">
              ✓ {selectedFiles.length} foto{selectedFiles.length > 1 ? 's' : ''} seleccionada{selectedFiles.length > 1 ? 's' : ''}
            </p>
            <p className="text-sm text-green-600 mt-1">
              Listas para subir
            </p>
          </div>
        )}
      </div>

      {uploadedUrls.length > 0 && (
        <div className="w-full max-w-4xl mt-8">
          <h2 className="text-2xl font-bold text-center mb-6">
            Fotos subidas ({uploadedUrls.length})
          </h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4">
            {uploadedUrls.map((url, index) => (
              <div key={index} className="aspect-square relative overflow-hidden rounded-lg shadow-md">
                <img
                  src={url}
                  alt={`Foto ${index + 1}`}
                  className="w-full h-full object-cover hover:scale-110 transition-transform duration-300"
                />
              </div>
            ))}
          </div>
        </div>
      )}

      <p className="mt-6 text-xs sm:text-sm text-gray-400 text-center px-4">
        💡 Puedes seleccionar varias fotos a la vez
      </p>
    </div>
  );
}