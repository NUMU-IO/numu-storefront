"use client";

export default function StoreError({ error, reset }: { error: Error; reset: () => void }) {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <h1 className="text-2xl font-bold text-red-600">Something went wrong</h1>
        <p className="text-gray-500 mt-2">{error.message}</p>
        <button onClick={reset} className="mt-4 px-4 py-2 bg-blue-600 text-white rounded">
          Try again
        </button>
      </div>
    </div>
  );
}
