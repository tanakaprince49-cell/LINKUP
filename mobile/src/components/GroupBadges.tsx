import React from 'react';
import {View} from 'react-native';
import VerifiedBadge from './VerifiedBadge';
export default function GroupBadges({verified=false,gold=false,size=17}:{verified?:boolean;gold?:boolean;size?:number}){
 return <View style={{flexDirection:'row',gap:4,alignItems:'center'}}>{(verified||gold)&&<VerifiedBadge size={size} accessibilityLabel="PLUS-created group"/>}{gold&&<VerifiedBadge size={size} color="#e0be1b" checkColor="#FFFFFF" accessibilityLabel="LINKUP CEO-created group"/>}</View>;
}
