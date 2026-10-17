import React, {useMemo} from 'react';
import {Linking, Text, TextProps} from 'react-native';
import {linkyTextParts, LinkyTextProfile} from '../lib/linkyText';
import {notifyUser} from '../lib/notify';

type Props = TextProps & {text: string; isDark: boolean; profiles?: LinkyTextProfile[]; onProfile?: (uid: string)=>void};
export default function LinkyRichText({text,isDark,profiles,onProfile,...props}: Props) {
  const parts=useMemo(()=>linkyTextParts(text,profiles),[text,profiles]);
  return <Text {...props} selectable>{parts.map((part,i)=>part.url || (part.uid && onProfile) ? (
    <Text key={i} accessibilityRole="link" accessibilityLabel={part.uid ? `Open ${part.text}’s profile` : `Open link: ${part.text}`}
      style={{color:isDark?'#9ED8FF':'#075EA8',backgroundColor:isDark?'#203F56':'#E4F1FF',fontWeight:'800',textDecorationLine:'underline'}}
      onPress={()=>part.uid && onProfile ? onProfile(part.uid) : part.url ? void Linking.openURL(part.url).catch(()=>notifyUser('Could not open that link','Please copy the link and open it in your browser.')) : undefined}>
      {part.text}
    </Text>
  ) : part.text)}</Text>;
}
