import * as ImagePicker from 'expo-image-picker';
import {uploadImageToImageKit} from './imagekitUpload';
export async function pickGroupPhoto(uid:string){
 const permission=await ImagePicker.requestMediaLibraryPermissionsAsync();if(!permission.granted)throw new Error('Allow photo access to choose a group picture.');
 const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:['images'],allowsEditing:true,aspect:[1,1],quality:0.65,base64:true});if(result.canceled)return null;const asset=result.assets[0];if(!asset?.base64)throw new Error('Could not read this photo. Choose another image.');if(asset.base64.length>5500000)throw new Error('Choose an image smaller than 4 MB.');
 const url=await uploadImageToImageKit(uid,'data:'+(asset.mimeType||'image/jpeg')+';base64,'+asset.base64,{folder:'/linkup-groups',fileName:'group-'+Date.now()+'.jpg',useUniqueFileName:true});if(!url)throw new Error('Group photo upload failed. Please retry.');return url;
}
