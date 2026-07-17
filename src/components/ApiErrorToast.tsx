import { useEffect, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';

interface ApiErrorDetail {
  message: string;
}

export default function ApiErrorToast() {
  const [message, setMessage] = useState('');

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const handleError = (event: Event) => {
      const detail = (event as CustomEvent<ApiErrorDetail>).detail;
      setMessage(detail.message);
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => setMessage(''), 8000);
    };
    window.addEventListener('workbench:api-error', handleError);
    return () => {
      window.removeEventListener('workbench:api-error', handleError);
      if (timer) clearTimeout(timer);
    };
  }, []);

  if (!message) return null;

  return (
    <div className="fixed right-5 top-5 z-[100] flex max-w-md items-start gap-3 rounded-xl border border-red-500/30 bg-[#2a1720] px-4 py-3 text-sm text-red-100 shadow-2xl">
      <AlertCircle className="mt-0.5 flex-shrink-0 text-red-400" size={17} />
      <span className="flex-1 break-words">{message}</span>
      <button onClick={() => setMessage('')} className="text-red-300/70 hover:text-white" aria-label="关闭错误提示">
        <X size={15} />
      </button>
    </div>
  );
}

