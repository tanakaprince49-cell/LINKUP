import React from 'react';
import TrendingBuildersScreen from './TrendingBuildersScreen';
// Same server-recorded scores as the global board, filtered by profile location.
export default function CityLeagueScreen(props:any){return <TrendingBuildersScreen {...props} local/>;}
