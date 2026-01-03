
'use client';

import { createContext, useState, ReactNode } from 'react';

type SimulationContextType = {
    simulationDate: Date | null;
    setSimulationDate: (date: Date | null) => void;
};

export const SimulationContext = createContext<SimulationContextType>({
    simulationDate: null,
    setSimulationDate: () => {},
});

export const SimulationProvider = ({ children }: { children: ReactNode }) => {
    const [simulationDate, setSimulationDate] = useState<Date | null>(null);

    return (
        <SimulationContext.Provider value={{ simulationDate, setSimulationDate }}>
            {children}
        </SimulationContext.Provider>
    );
};
