import { useState, useEffect } from 'react';
import { X } from 'lucide-react';

interface Step {
  title: string;
  description: string;
  target: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

const STEPS: Step[] = [
  { title: 'Welcome to Infra Pilot!', description: 'This quick tour will show you the key features.', target: '#dashboard-welcome', position: 'bottom' },
  { title: 'Your Apps', description: 'Manage your Docker containers here. Create, start, stop, and monitor apps.', target: '[data-tour="apps"]', position: 'right' },
  { title: 'Monitoring', description: 'View real-time metrics, performance charts, and system health.', target: '[data-tour="monitoring"]', position: 'right' },
  { title: 'Backups', description: 'Schedule automated backups and manage retention policies.', target: '[data-tour="backups"]', position: 'right' },
  { title: 'Alerts', description: 'Configure threshold alerts to get notified when something needs attention.', target: '[data-tour="settings"]', position: 'right' },
];

export function OnboardingWizard() {
  const [isOpen, setIsOpen] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    const seen = localStorage.getItem('onboarding_seen');
    if (!seen) {
      setTimeout(() => setIsOpen(true), 500);
    }
  }, []);

  const dismiss = () => {
    setIsOpen(false);
    localStorage.setItem('onboarding_seen', 'true');
  };

  const next = () => {
    if (currentStep < STEPS.length - 1) setCurrentStep(s => s + 1);
    else dismiss();
  };

  if (!isOpen) return null;

  const step = STEPS[currentStep];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-white dark:bg-gray-800 rounded-lg shadow-2xl p-6 max-w-md w-full mx-4 relative">
        <button onClick={dismiss} className="absolute top-2 right-2 text-gray-400 hover:text-gray-600">
          <X className="w-5 h-5" />
        </button>
        <div className="mb-4">
          <div className="flex gap-1 mb-4">
            {STEPS.map((_, i) => (
              <div key={i} className={`h-1 flex-1 rounded ${i <= currentStep ? 'bg-blue-500' : 'bg-gray-300 dark:bg-gray-600'}`} />
            ))}
          </div>
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-2">{step.title}</h3>
          <p className="text-gray-600 dark:text-gray-300">{step.description}</p>
        </div>
        <div className="flex justify-between items-center">
          <span className="text-sm text-gray-400">{currentStep + 1} / {STEPS.length}</span>
          <div className="flex gap-2">
            <button onClick={dismiss} className="px-3 py-1.5 text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 rounded">Skip</button>
            <button onClick={next} className="px-4 py-1.5 text-sm bg-blue-500 text-white rounded hover:bg-blue-600">
              {currentStep < STEPS.length - 1 ? 'Next' : 'Get Started'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
