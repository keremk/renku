import renkuLogo from '../../../../web/public/logo.svg';

export function StepWelcome() {
  return (
    <div className='flex flex-col items-center text-center gap-4 py-4'>
      <img
        src={renkuLogo}
        alt='Renku'
        className='h-16 w-16 rounded-xl object-contain'
      />
      <div className='space-y-2'>
        <h1 className='text-2xl font-semibold'>Welcome to Renku</h1>
        <p className='text-sm text-muted-foreground max-w-sm'>
          Renku is an AI movie production platform that orchestrates AI video,
          audio, and image generation into complete cinematic productions.
        </p>
      </div>
      <p className='text-sm text-muted-foreground'>
        {"You're 4 steps away from your first movie."}
      </p>
    </div>
  );
}
